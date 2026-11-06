-- 030: link-rot scanner. Adds health columns to oneclist_items and three service-role-only functions the
-- check-link-health Edge Function uses (claim a batch / apply one result / release unprocessed claims). Re-runnable.
--
-- Policy (lives here so the function cannot drift from it):
--   * A link is marked dead only after CONFIRMED failures: 2 in a row that include hard failures (404, 410, DNS NXDOMAIN),
--     or 3 in a row of any kind (5xx, timeouts, connection errors). One bad day never marks a link dead.
--   * "Blocked by the site" answers (401/403/429/451/999) count as alive. A later success clears the dead flag.
--   * Schedule: healthy 14 days, failing 1 day, dead 7 days (to notice recovery), skipped 14 days.
alter table oneclist_items
  add column if not exists is_private          boolean     not null default false,
  add column if not exists is_dead             boolean     not null default false,
  add column if not exists dead_since          timestamptz,
  add column if not exists archive_url         text,
  add column if not exists archive_snapshot_at timestamptz,
  add column if not exists link_checked_at     timestamptz,
  add column if not exists link_http_status    int,
  add column if not exists link_error          text,                          -- short code only (http_404, timeout, dns_nxdomain...), never raw network text
  add column if not exists link_fail_count     int         not null default 0,
  add column if not exists link_fail_hard      int         not null default 0,
  add column if not exists link_claimed_at     timestamptz;

-- First check one day after saving. Existing rows are spread over 14 days so the first scan is not one giant wave.
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'oneclist_items' and column_name = 'link_next_check_at') then
    alter table oneclist_items add column link_next_check_at timestamptz not null default now() + interval '1 day';
    update oneclist_items set link_next_check_at = now() + random() * interval '14 days';
  end if;
end $$;

alter table oneclist_items drop constraint if exists oneclist_items_archive_url_chk;
alter table oneclist_items add constraint oneclist_items_archive_url_chk
  check (archive_url is null or (length(archive_url) <= 2200 and archive_url ~ '^https://web\.archive\.org/web/[0-9]{1,14}[a-z_]{0,3}/https?://.+$'));   -- a user can never store a javascript: or look-alike address here

create index if not exists oneclist_items_link_due on oneclist_items (link_next_check_at) where url ~* '^https?://';
create index if not exists oneclist_items_dead on oneclist_items (user_id) where is_dead;

-- ---------------------------------------------------------------------------------------------------------------------
-- Claim the next batch. SKIP LOCKED: two overlapping runs never take the same row. A claim older than 10 minutes is considered abandoned.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function link_health_claim(p_limit int default 50)
returns table (id uuid, url text, is_private boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  return query
  with c as (
    select i.id from oneclist_items i
    where i.url ~* '^https?://' and i.link_next_check_at <= now()
      and (i.link_claimed_at is null or i.link_claimed_at < now() - interval '10 minutes')
    order by i.link_next_check_at
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
    for update skip locked)
  update oneclist_items t set link_claimed_at = now() from c where t.id = c.id
  returning t.id, t.url, coalesce(t.is_private, false);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Apply one result. p_outcome: ok | hard | soft | skip.  Returns the new state so the caller can count newly dead links.
-- p_archive_url is only stored when it matches the Wayback pattern; a bad value is ignored rather than failing the update.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function link_health_apply(p_id uuid, p_outcome text, p_status int default null, p_error text default null,
                                             p_archive_url text default null, p_snapshot_at timestamptz default null)
returns table (is_dead boolean, newly_dead boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare r record; fails int; hards int; dead boolean; arch text;
begin
  if p_outcome not in ('ok', 'hard', 'soft', 'skip') then raise exception 'bad_outcome' using errcode = '22023'; end if;
  select * into r from oneclist_items i where i.id = p_id for update;
  if not found then return; end if;
  arch := case when p_archive_url ~ '^https://web\.archive\.org/web/[0-9]{1,14}[a-z_]{0,3}/https?://.+$' and length(p_archive_url) <= 2200 then p_archive_url end;
  p_error := left(regexp_replace(coalesce(p_error, ''), '[^a-z0-9_]', '', 'g'), 40);

  if p_outcome = 'skip' then
    update oneclist_items i set link_checked_at = now(), link_error = nullif(p_error, ''), link_claimed_at = null, link_next_check_at = now() + interval '14 days' where i.id = p_id;
    return query select r.is_dead, false; return;
  elsif p_outcome = 'ok' then
    update oneclist_items i set is_dead = false, dead_since = null, link_fail_count = 0, link_fail_hard = 0, link_checked_at = now(), link_http_status = p_status,
      link_error = nullif(p_error, ''), link_claimed_at = null, link_next_check_at = now() + interval '14 days' where i.id = p_id;       -- archive_url is kept: still a valid snapshot
    return query select false, false; return;
  end if;

  fails := r.link_fail_count + 1; hards := r.link_fail_hard + (case when p_outcome = 'hard' then 1 else 0 end);
  dead := r.is_dead or hards >= 2 or fails >= 3;
  update oneclist_items i set
    link_fail_count = fails, link_fail_hard = hards, is_dead = dead, dead_since = case when dead then coalesce(r.dead_since, now()) else null end,
    archive_url = coalesce(arch, i.archive_url), archive_snapshot_at = case when arch is not null then p_snapshot_at else i.archive_snapshot_at end,
    link_checked_at = now(), link_http_status = p_status, link_error = nullif(p_error, ''), link_claimed_at = null,
    link_next_check_at = now() + case when dead then interval '7 days' else interval '1 day' end
  where i.id = p_id;
  return query select dead, (dead and not r.is_dead);
end $$;

create or replace function link_health_release(p_ids uuid[])
returns void language sql security definer set search_path = public as $$
  update oneclist_items set link_claimed_at = null where id = any(p_ids) and link_claimed_at is not null;
$$;

revoke all on function link_health_claim(int), link_health_apply(uuid, text, int, text, text, timestamptz), link_health_release(uuid[]) from public, anon, authenticated;
grant execute on function link_health_claim(int), link_health_apply(uuid, text, int, text, text, timestamptz), link_health_release(uuid[]) to service_role;
