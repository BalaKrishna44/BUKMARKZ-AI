-- 010: public curated Stacks. A stack is a SNAPSHOT (title, url, optional blurb) of selected bookmarks:
-- later edits/deletes of the private bookmark never leak, and notes/summaries are never copied.
create table if not exists creator_profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  handle     text not null unique check (handle ~ '^[a-z0-9_]{3,20}$'),
  created_at timestamptz not null default now()
);
create table if not exists stacks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 60),
  title       text not null check (char_length(title) between 3 and 80),
  description text check (description is null or char_length(description) <= 280),
  theme       text not null default 'mint' check (theme in ('mint','ocean','sunset','violet','midnight')),
  is_public   boolean not null default true,
  is_blocked  boolean not null default false,           -- moderation switch; only service role / SQL editor can set it
  fork_count  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists stacks_user_idx on stacks(user_id, created_at desc);
create table if not exists stack_items (
  stack_id uuid not null references stacks(id) on delete cascade,
  position smallint not null check (position between 0 and 49),
  title    text not null check (char_length(title) between 1 and 200),
  url      text not null check (url ~* '^https?://' and char_length(url) <= 2048),
  blurb    text check (blurb is null or char_length(blurb) <= 200),
  primary key (stack_id, position)
);
create table if not exists stack_forks (
  stack_id uuid not null references stacks(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (stack_id, user_id)                       -- one counted fork per user
);

alter table creator_profiles enable row level security;
alter table stacks           enable row level security;
alter table stack_items      enable row level security;
alter table stack_forks      enable row level security;
revoke all on creator_profiles, stacks, stack_items, stack_forks from anon;       -- the public reads ONLY through get_public_stack()

drop policy if exists profiles_owner on creator_profiles;
create policy profiles_owner on creator_profiles for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists stacks_owner on stacks;
create policy stacks_owner on stacks for all to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid() and is_blocked = false);                          -- an owner cannot un-block their own stack
drop policy if exists stack_items_owner on stack_items;
create policy stack_items_owner on stack_items for all to authenticated
  using (exists (select 1 from stacks s where s.id = stack_id and s.user_id = auth.uid()))
  with check (exists (select 1 from stacks s where s.id = stack_id and s.user_id = auth.uid()));
drop policy if exists stack_forks_owner on stack_forks;
create policy stack_forks_owner on stack_forks for select to authenticated using (user_id = auth.uid());

grant select, insert, update, delete on creator_profiles, stack_items to authenticated;
grant select on stack_forks to authenticated;
-- Owners may edit these columns only; is_blocked / fork_count / user_id / slug are not writable from the API.
revoke update on stacks from authenticated;
grant select, insert, delete on stacks to authenticated;
grant update (title, description, theme, is_public, updated_at) on stacks to authenticated;

-- Public read: no user_id, no email, nothing private. Unknown, private and blocked stacks look identical (null).
create or replace function get_public_stack(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'slug', s.slug, 'title', s.title, 'description', s.description, 'theme', s.theme, 'handle', p.handle,
    'created_at', s.created_at, 'updated_at', s.updated_at, 'fork_count', s.fork_count,
    'items', coalesce((select jsonb_agg(jsonb_build_object('title', i.title, 'url', i.url, 'blurb', i.blurb) order by i.position)
                       from stack_items i where i.stack_id = s.id), '[]'::jsonb))
  from stacks s join creator_profiles p on p.user_id = s.user_id
  where s.slug = lower(p_slug) and s.is_public and not s.is_blocked;
$$;
revoke all on function get_public_stack(text) from public;
grant execute on function get_public_stack(text) to anon, authenticated;

-- Atomic create. SECURITY INVOKER: RLS applies, and ownership is re-checked here (the API's validation is not the security boundary).
-- p_items: [{"id": "<oneclist_items uuid>", "blurb": "optional"}], order is kept, max 50.
create or replace function create_stack(p_title text, p_description text, p_theme text, p_slug text, p_handle text, p_items jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare uid uuid := auth.uid(); sid uuid; n int; h text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if (select count(*) from stacks where user_id = uid) >= 100 then raise exception 'too_many_stacks'; end if;
  if (select count(*) from stacks where user_id = uid and created_at > now() - interval '1 day') >= 20 then raise exception 'rate_limited'; end if;

  select handle into h from creator_profiles where user_id = uid;
  if h is null then
    if p_handle is null or p_handle !~ '^[a-z0-9_]{3,20}$' then raise exception 'handle_required'; end if;
    begin insert into creator_profiles(user_id, handle) values (uid, p_handle); h := p_handle;
    exception when unique_violation then raise exception 'handle_taken'; end;
  end if;

  begin
    insert into stacks(user_id, slug, title, description, theme) values (uid, lower(p_slug), btrim(p_title), nullif(btrim(coalesce(p_description,'')), ''), coalesce(p_theme,'mint'))
    returning id into sid;
  exception when unique_violation then raise exception 'slug_taken'; end;

  with src as (
    select o.id, o.url, o.title, e.ord, nullif(left(btrim(coalesce(e.j->>'blurb','')), 200), '') as blurb,
           row_number() over (partition by o.id order by e.ord) as dup
    from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) with ordinality as e(j, ord)
    join oneclist_items o on o.user_id = uid
      and e.j->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and o.id = (e.j->>'id')::uuid      -- a malformed id is skipped, not an error
    where o.url ~* '^https?://' and coalesce(o.ai_status, '') <> 'skipped_private'       -- no scans (bukmarkz://), nothing the user marked private
  ), picked as (
    select *, row_number() over (order by ord) - 1 as pos from src where dup = 1
  )
  insert into stack_items(stack_id, position, title, url, blurb)
  select sid, pos, left(coalesce(nullif(btrim(title), ''), substring(url from '^https?://([^/?#]+)')), 200), url, blurb from picked where pos < 50;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'no_valid_items'; end if;                                  -- aborts everything, stack row included
  return jsonb_build_object('id', sid, 'slug', lower(p_slug), 'count', n, 'handle', h);
end $$;
revoke all on function create_stack(text, text, text, text, text, jsonb) from public, anon;
grant execute on function create_stack(text, text, text, text, text, jsonb) to authenticated;

-- Fork: copy the stack's links into the caller's own bookmarks (existing URLs are skipped), tagged so they are easy to find.
create or replace function fork_stack(p_slug text) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); sid uuid; n int; fresh int;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select id into sid from stacks where slug = lower(p_slug) and is_public and not is_blocked;
  if sid is null then raise exception 'not_found'; end if;
  insert into oneclist_items(user_id, url, url_key, title, tags, source, status, ai_status)
  select uid, i.url, lower(regexp_replace(regexp_replace(split_part(i.url, '#', 1), '^https?://(www\.)?', ''), '/+$', '')),
         i.title, array['stack-' || lower(p_slug)], 'stack_fork', 'bookmark', 'pending'
  from stack_items i where i.stack_id = sid
  on conflict (user_id, url_key) do nothing;
  get diagnostics n = row_count;
  insert into stack_forks(stack_id, user_id) values (sid, uid) on conflict do nothing;
  get diagnostics fresh = row_count;
  if fresh > 0 then update stacks set fork_count = fork_count + 1 where id = sid; end if;
  return n;
end $$;
revoke all on function fork_stack(text) from public, anon;
grant execute on function fork_stack(text) to authenticated;
