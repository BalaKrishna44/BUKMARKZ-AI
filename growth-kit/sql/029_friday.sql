-- 029: "Friday Vault After-Hours". A weekly joke email sent at 16:00 LOCAL time on Fridays. OPT-IN (enabled=false until the user turns it on), one-click unsubscribe.
-- Needs 021 (referral_codes) and the items table. Re-runnable. Service-role only except set_friday_enabled().

create table if not exists friday_prefs (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  enabled      boolean not null default false,
  tz           text not null default 'UTC',                         -- IANA name, validated by set_friday_enabled()
  last_sent_at timestamptz,
  updated_at   timestamptz not null default now()
);
-- One joke per ISO week for EVERYONE (one AI call a week, not one per user). status 'blocked' = a human pulled it; the sender then uses the curated pool.
create table if not exists friday_jokes (
  week_key   text primary key check (week_key ~ '^[0-9]{4}-W[0-9]{2}$'),
  turns      jsonb not null check (jsonb_typeof(turns) = 'array' and jsonb_array_length(turns) between 2 and 8),
  source     text not null check (source in ('pool', 'ai', 'manual')),
  status     text not null default 'ready' check (status in ('ready', 'blocked')),
  created_at timestamptz not null default now()
);
alter table friday_prefs enable row level security; alter table friday_jokes enable row level security;
revoke all on friday_prefs, friday_jokes from anon, authenticated;
grant select on friday_prefs to authenticated;
drop policy if exists friday_prefs_own on friday_prefs; create policy friday_prefs_own on friday_prefs for select to authenticated using (user_id = auth.uid());

-- The signed-in user opts in or out. Pass the browser's Intl.DateTimeFormat().resolvedOptions().timeZone; an unknown name falls back to UTC.
create or replace function set_friday_enabled(p_on boolean, p_tz text default null) returns void
language plpgsql security definer set search_path = public as $$
declare tzv text := 'UTC'; cand text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_tz is not null and length(p_tz) <= 64 and (p_tz = 'UTC' or p_tz ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){1,2}$') then
    -- Browsers still report some retired names (Asia/Calcutta, Europe/Kiev); not every Postgres build ships those aliases, so map them first.
    cand := case p_tz when 'Asia/Calcutta' then 'Asia/Kolkata' when 'Asia/Saigon' then 'Asia/Ho_Chi_Minh' when 'Asia/Katmandu' then 'Asia/Kathmandu'
      when 'Asia/Rangoon' then 'Asia/Yangon' when 'Europe/Kiev' then 'Europe/Kyiv' when 'America/Buenos_Aires' then 'America/Argentina/Buenos_Aires' else p_tz end;
    begin perform now() at time zone cand; tzv := cand; exception when others then tzv := 'UTC'; end;   -- Postgres itself is the judge of what is a real zone
  end if;
  insert into friday_prefs(user_id, enabled, tz) values (auth.uid(), p_on, tzv)
  on conflict (user_id) do update set enabled = excluded.enabled, tz = case when p_tz is null then friday_prefs.tz else excluded.tz end, updated_at = now();
end $$;

-- Run hourly (p_now exists so tests can pick the instant). Claims people for whom it is Friday 16:00-17:59 right now, in THEIR time zone, and who were not mailed in the last 5 days.
-- Two hours of slack means one missed cron tick does not cost anyone their week. A second firing in the same hour claims nothing.
create or replace function claim_friday_users(p_limit int default 200, p_now timestamptz default now()) returns table(user_id uuid)
language sql security definer set search_path = public as $$
  with due as (
    select f.user_id from friday_prefs f
    where f.enabled
      and extract(isodow from (p_now at time zone f.tz)) = 5 and extract(hour from (p_now at time zone f.tz)) in (16, 17)
      and (f.last_sent_at is null or f.last_sent_at < p_now - interval '5 days')
    order by f.last_sent_at nulls first limit greatest(1, least(p_limit, 500)) for update skip locked)
  update friday_prefs f set last_sent_at = p_now from due where f.user_id = due.user_id returning f.user_id
$$;
create or replace function friday_release(p_user uuid) returns void   -- send failed: the next hourly run may retry (while still inside the window)
language sql security definer set search_path = public as $$ update friday_prefs set last_sent_at = null where user_id = p_user $$;

-- Links saved in the last 7 days (a number only; no titles, so nothing private can leak into the email).
create or replace function friday_week_saves(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from oneclist_items where user_id = p_user and created_at > now() - interval '7 days' $$;

-- Same as get_or_create_referral_code() (021) but for the service role, which has no auth.uid().
create or replace function friday_referral_code(p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text; tries int := 0;
begin
  select code into c from referral_codes where user_id = p_user; if c is not null then return c; end if;
  loop
    tries := tries + 1; c := _rand_code();
    begin insert into referral_codes(user_id, code) values (p_user, c); return c;
    exception when unique_violation then
      select code into c from referral_codes where user_id = p_user; if c is not null then return c; end if;
      if tries > 10 then raise exception 'code_generation_failed'; end if;
    end;
  end loop;
end $$;

-- Store this week's joke once. Returns the stored row (so two racing workers agree). A 'blocked' row stays blocked.
create or replace function friday_store_joke(p_week text, p_turns jsonb, p_source text) returns table(turns jsonb, source text, status text)
language plpgsql security definer set search_path = public as $$
begin
  insert into friday_jokes(week_key, turns, source) values (p_week, p_turns, p_source) on conflict (week_key) do nothing;
  return query select j.turns, j.source, j.status from friday_jokes j where j.week_key = p_week;
end $$;
create or replace function friday_get_joke(p_week text) returns table(turns jsonb, source text, status text)
language sql stable security definer set search_path = public as $$ select j.turns, j.source, j.status from friday_jokes j where j.week_key = p_week $$;

revoke all on function set_friday_enabled(boolean, text), claim_friday_users(int, timestamptz), friday_release(uuid), friday_week_saves(uuid), friday_referral_code(uuid),
  friday_store_joke(text, jsonb, text), friday_get_joke(text) from public, anon, authenticated;
grant execute on function set_friday_enabled(boolean, text) to authenticated;
grant execute on function claim_friday_users(int, timestamptz), friday_release(uuid), friday_week_saves(uuid), friday_referral_code(uuid), friday_store_joke(text, jsonb, text), friday_get_joke(text) to service_role;
