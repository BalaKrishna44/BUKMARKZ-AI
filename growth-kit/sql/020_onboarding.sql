-- 020: first-run onboarding state + starter stacks. Run after dash/sql/010 and 012 and importexport/001.
create table if not exists onboarding_progress (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  dismissed_at     timestamptz,
  extension_seen_at timestamptz,
  first_ask_at     timestamptz,
  first_remix_at   timestamptz,
  created_at       timestamptz not null default now()
);
alter table onboarding_progress enable row level security;
revoke all on onboarding_progress from anon, authenticated;
grant select on onboarding_progress to authenticated;
drop policy if exists onboarding_owner_read on onboarding_progress;
create policy onboarding_owner_read on onboarding_progress for select to authenticated using (user_id = auth.uid());

-- Starter stacks are ordinary public stacks flagged by the service role (the flag is not writable from the API).
alter table stacks add column if not exists is_starter boolean not null default false;
create index if not exists stacks_starter_idx on stacks(is_starter) where is_starter;

create or replace function onboarding_mark(p_step text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_step not in ('extension','ask','remix','dismiss') then raise exception 'bad_step'; end if;
  insert into onboarding_progress(user_id) values (uid) on conflict (user_id) do nothing;
  update onboarding_progress set
    extension_seen_at = case when p_step = 'extension' then coalesce(extension_seen_at, now()) else extension_seen_at end,
    first_ask_at      = case when p_step = 'ask'       then coalesce(first_ask_at, now())       else first_ask_at end,
    first_remix_at    = case when p_step = 'remix'     then coalesce(first_remix_at, now())     else first_remix_at end,
    dismissed_at      = case when p_step = 'dismiss'   then coalesce(dismissed_at, now())       else dismissed_at end
  where user_id = uid;
end $$;

create or replace function onboarding_state() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'items',     (select count(*) from oneclist_items where user_id = auth.uid()),
    'dismissed', coalesce((select dismissed_at is not null from onboarding_progress where user_id = auth.uid()), false),
    'extension', coalesce((select extension_seen_at is not null from onboarding_progress where user_id = auth.uid()), false),
    'asked',     coalesce((select first_ask_at is not null from onboarding_progress where user_id = auth.uid()), false),
    'remixed',   coalesce((select first_remix_at is not null from onboarding_progress where user_id = auth.uid()), false) or exists (select 1 from stack_remixes r join stacks s on s.id = r.remixed_stack_id where s.user_id = auth.uid()))
  where auth.uid() is not null;
$$;

create or replace function list_starter_stacks() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('slug', s.slug, 'title', s.title, 'description', s.description,
           'item_count', (select count(*) from stack_items i where i.stack_id = s.id)) order by s.created_at), '[]'::jsonb)
  from stacks s where s.is_starter and s.is_public and not s.is_blocked and auth.uid() is not null;
$$;

revoke all on function onboarding_mark(text), onboarding_state(), list_starter_stacks() from public, anon;
grant execute on function onboarding_mark(text), onboarding_state(), list_starter_stacks() to authenticated;
grant execute on function onboarding_mark(text), onboarding_state(), list_starter_stacks() to service_role;
