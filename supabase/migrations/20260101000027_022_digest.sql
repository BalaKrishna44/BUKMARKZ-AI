-- 022: weekly "links you forgot" email. Opt-IN by default (enabled=false until the user turns it on), one-click unsubscribe.
create table if not exists digest_prefs (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  enabled        boolean not null default false,
  last_sent_at   timestamptz,
  last_item_ids  uuid[] not null default '{}',
  updated_at     timestamptz not null default now()
);
alter table digest_prefs enable row level security;
revoke all on digest_prefs from anon, authenticated;
grant select on digest_prefs to authenticated;
drop policy if exists digest_prefs_own on digest_prefs; create policy digest_prefs_own on digest_prefs for select to authenticated using (user_id = auth.uid());

create or replace function set_digest_enabled(p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  insert into digest_prefs(user_id, enabled) values (auth.uid(), p_on)
  on conflict (user_id) do update set enabled = excluded.enabled, updated_at = now();
end $$;

-- Service role: atomically claim up to p_limit users who are due (enabled, not mailed in the last 6 days). A second cron firing gets nothing.
create or replace function claim_digest_users(p_limit int default 200) returns table(user_id uuid, last_item_ids uuid[])
language sql security definer set search_path = public as $$
  with due as (
    select d.user_id from digest_prefs d
    where d.enabled and (d.last_sent_at is null or d.last_sent_at < now() - interval '6 days')
    order by d.last_sent_at nulls first limit greatest(1, least(p_limit, 500)) for update skip locked)
  update digest_prefs d set last_sent_at = now() from due where d.user_id = due.user_id returning d.user_id, d.last_item_ids;
$$;

-- Up to p_limit links saved at least 14 days ago, never private, not shown last time, spread across the library.
create or replace function digest_pick_items(p_user uuid, p_exclude uuid[], p_limit int default 5) returns table(id uuid, title text, url text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id, i.title, i.url, i.created_at from oneclist_items i
  where i.user_id = p_user and not i.is_private and i.created_at < now() - interval '14 days' and not (i.id = any(coalesce(p_exclude, '{}')))
  order by md5(i.id::text || to_char(now(), 'IYYY-IW')) limit greatest(1, least(p_limit, 10));
$$;

create or replace function digest_release(p_user uuid) returns void   -- sending failed: let the next run retry
language sql security definer set search_path = public as $$ update digest_prefs set last_sent_at = null where user_id = p_user $$;
create or replace function digest_record(p_user uuid, p_ids uuid[]) returns void
language sql security definer set search_path = public as $$ update digest_prefs set last_item_ids = coalesce(p_ids, '{}') where user_id = p_user $$;

revoke all on function set_digest_enabled(boolean), claim_digest_users(int), digest_pick_items(uuid, uuid[], int), digest_release(uuid), digest_record(uuid, uuid[]) from public, anon, authenticated;
grant execute on function set_digest_enabled(boolean) to authenticated;
grant execute on function claim_digest_users(int), digest_pick_items(uuid, uuid[], int), digest_release(uuid), digest_record(uuid, uuid[]), set_digest_enabled(boolean) to service_role;
