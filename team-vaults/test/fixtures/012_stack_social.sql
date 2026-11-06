-- 012: Live Stacks — Follow & Remix. Run after 010_stacks.sql.
-- Follow = a per-user subscription to a public stack. Remix = a NEW stack owned by the remixer, copied from a public one,
-- with a permanent (but visibility-aware) credit back to the original.

alter table creator_profiles add column if not exists avatar_url text
  check (avatar_url is null or (avatar_url ~ '^https://' and char_length(avatar_url) <= 500));    -- the app additionally pins it to our own Storage origin
alter table stacks add column if not exists follower_count int not null default 0;
alter table stacks add column if not exists remix_count    int not null default 0;

create table if not exists stack_follows (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  stack_id   uuid not null references stacks(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, stack_id)                                  -- following twice is impossible, not just ignored
);
create index if not exists stack_follows_stack_idx on stack_follows(stack_id);

create table if not exists stack_remixes (
  id                uuid primary key default gen_random_uuid(),
  original_stack_id uuid references stacks(id) on delete set null,       -- original deleted -> the remix survives, credit disappears
  remixed_stack_id  uuid not null unique references stacks(id) on delete cascade,   -- a remix has exactly one parent
  user_id           uuid not null references auth.users(id) on delete cascade,
  created_at        timestamptz not null default now()
);
create index if not exists stack_remixes_orig_idx on stack_remixes(original_stack_id, user_id);

alter table stack_follows enable row level security;
alter table stack_remixes enable row level security;
revoke all on stack_follows, stack_remixes from anon, authenticated;
grant select on stack_follows, stack_remixes to authenticated;           -- writes happen only inside the SECURITY DEFINER functions below
drop policy if exists stack_follows_owner on stack_follows;
create policy stack_follows_owner on stack_follows for select to authenticated using (user_id = auth.uid());
drop policy if exists stack_remixes_owner on stack_remixes;
create policy stack_remixes_owner on stack_remixes for select to authenticated using (user_id = auth.uid());

-- Hardening found while adding the counters: 010 granted table-level INSERT on stacks, so an owner could have inserted a row
-- with fork_count / follower_count / remix_count of their choosing straight through the REST API. Insert is now column-scoped.
revoke insert on stacks from authenticated;
grant insert (user_id, slug, title, description, theme, is_public) on stacks to authenticated;

-- Counters are maintained by trigger so they stay right under concurrency and on cascades.
create or replace function stack_follows_count() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then update stacks set follower_count = follower_count + 1 where id = new.stack_id;
  else update stacks set follower_count = greatest(follower_count - 1, 0) where id = old.stack_id; end if;
  return null;
end $$;
revoke all on function stack_follows_count() from public, anon, authenticated;
drop trigger if exists stack_follows_count_t on stack_follows;
create trigger stack_follows_count_t after insert or delete on stack_follows for each row execute function stack_follows_count();

-- Public read, now with follower/remix counts, the curator avatar and the "Remixed from" credit.
-- The credit is shown only while the original is still public and not blocked, so a remix can never be used to leak a hidden stack.
create or replace function get_public_stack(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'slug', s.slug, 'title', s.title, 'description', s.description, 'theme', s.theme, 'handle', p.handle, 'avatar_url', p.avatar_url,
    'created_at', s.created_at, 'updated_at', s.updated_at, 'fork_count', s.fork_count,
    'follower_count', s.follower_count, 'remix_count', s.remix_count,
    'remixed_from', (select jsonb_build_object('slug', o.slug, 'title', o.title, 'handle', op.handle)
                     from stack_remixes r join stacks o on o.id = r.original_stack_id join creator_profiles op on op.user_id = o.user_id
                     where r.remixed_stack_id = s.id and o.is_public and not o.is_blocked),
    'items', coalesce((select jsonb_agg(jsonb_build_object('title', i.title, 'url', i.url, 'blurb', i.blurb) order by i.position)
                       from stack_items i where i.stack_id = s.id), '[]'::jsonb))
  from stacks s join creator_profiles p on p.user_id = s.user_id
  where s.slug = lower(p_slug) and s.is_public and not s.is_blocked;
$$;
revoke all on function get_public_stack(text) from public;
grant execute on function get_public_stack(text) to anon, authenticated;

-- What the buttons need on page load: who am I, do I follow, is it mine. Safe for anon (returns authed=false).
create or replace function stack_viewer_state(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'authed', auth.uid() is not null,
    'own',    auth.uid() is not null and s.user_id = auth.uid(),
    'following', exists (select 1 from stack_follows f where f.stack_id = s.id and f.user_id = auth.uid()),
    'follower_count', s.follower_count)
  from stacks s where s.slug = lower(p_slug) and s.is_public and not s.is_blocked;
$$;
revoke all on function stack_viewer_state(text) from public;
grant execute on function stack_viewer_state(text) to anon, authenticated;

create or replace function follow_stack(p_slug text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); s stacks%rowtype; fresh int; c int;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into s from stacks where slug = lower(p_slug) and is_public and not is_blocked;
  if s.id is null then raise exception 'not_found'; end if;
  if s.user_id = uid then raise exception 'own_stack'; end if;
  if (select count(*) from stack_follows where user_id = uid) >= 500 then raise exception 'too_many_follows'; end if;
  insert into stack_follows(user_id, stack_id) values (uid, s.id) on conflict (user_id, stack_id) do nothing;
  get diagnostics fresh = row_count;
  select follower_count into c from stacks where id = s.id;
  return jsonb_build_object('following', true, 'follower_count', c, 'new', fresh > 0);
end $$;
revoke all on function follow_stack(text) from public, anon;
grant execute on function follow_stack(text) to authenticated;

-- Unfollow works even if the stack has since gone private/blocked (you can always leave).
create or replace function unfollow_stack(p_slug text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); sid uuid; c int;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select id into sid from stacks where slug = lower(p_slug);
  if sid is null then raise exception 'not_found'; end if;
  delete from stack_follows where user_id = uid and stack_id = sid;
  select follower_count into c from stacks where id = sid;
  return jsonb_build_object('following', false, 'follower_count', c);
end $$;
revoke all on function unfollow_stack(text) from public, anon;
grant execute on function unfollow_stack(text) to authenticated;

-- Remix: one atomic transaction creates the caller's own stack (title, description, theme and every link of the original),
-- records the lineage, and bumps remix_count once per (user, original). Same limits and handle flow as create_stack.
create or replace function remix_stack(p_slug text, p_new_slug text, p_handle text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); o stacks%rowtype; sid uuid; h text; n int; again boolean;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into o from stacks where slug = lower(p_slug) and is_public and not is_blocked;
  if o.id is null then raise exception 'not_found'; end if;
  if o.user_id = uid then raise exception 'own_stack'; end if;
  if (select count(*) from stacks where user_id = uid) >= 100 then raise exception 'too_many_stacks'; end if;
  if (select count(*) from stacks where user_id = uid and created_at > now() - interval '1 day') >= 20 then raise exception 'rate_limited'; end if;

  select handle into h from creator_profiles where user_id = uid;
  if h is null then
    if p_handle is null or p_handle !~ '^[a-z0-9_]{3,20}$' then raise exception 'handle_required'; end if;
    begin insert into creator_profiles(user_id, handle) values (uid, p_handle); h := p_handle;
    exception when unique_violation then raise exception 'handle_taken'; end;
  end if;

  begin
    insert into stacks(user_id, slug, title, description, theme) values (uid, lower(p_new_slug), o.title, o.description, o.theme) returning id into sid;
  exception when unique_violation then raise exception 'slug_taken'; end;

  insert into stack_items(stack_id, position, title, url, blurb)
  select sid, position, title, url, blurb from stack_items where stack_id = o.id;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'not_found'; end if;                                       -- nothing to remix; rolls back the stack row too

  again := exists (select 1 from stack_remixes where original_stack_id = o.id and user_id = uid);
  insert into stack_remixes(original_stack_id, remixed_stack_id, user_id) values (o.id, sid, uid);
  if not again then update stacks set remix_count = remix_count + 1 where id = o.id; end if;   -- repeat remixes by one user don't inflate the count
  return jsonb_build_object('id', sid, 'slug', lower(p_new_slug), 'count', n, 'handle', h);
end $$;
revoke all on function remix_stack(text, text, text) from public, anon;
grant execute on function remix_stack(text, text, text) to authenticated;
