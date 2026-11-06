-- 017: Team Vaults (multi-tenant workspaces). Run after 001 (items), 004 (vector search), 010 + 012 (stacks).
--
-- Model
--   organizations / org_members   a workspace and its people. Roles: viewer < editor < admin < owner.
--   oneclist_items.org_id, stacks.org_id   NULL = personal (exactly as before). Set = shared with that workspace.
--   org_mcp_tokens                 workspace-level MCP tokens (buk_org_...), usable by AI tools to search the workspace and nothing else.
--
-- Where the rules live
--   * RLS decides what a signed-in user can SEE and which rows they can touch at all.
--   * Security-definer triggers decide every CHANGE that matters (who may add/promote/remove people, who may move data in or out of a workspace).
--     A client that sends hand-written UPDATEs to org_members or oneclist_items.org_id hits the trigger, not just a policy, so there is no
--     way to promote yourself, move another person's item, or publish a team stack by crafting a request.
--   * The server (service role, auth.uid() IS NULL) is trusted by the triggers; the Org MCP route re-derives the workspace from the token itself.
--
-- Known limits (also in the README)
--   * unique(user_id, url_key) from 001 is unchanged, so one person cannot hold the same URL personally AND in a workspace; moving
--     (UPDATE org_id) is the sharing flow. A workspace also dedupes URLs across its members (unique(org_id, url_key)).
--   * Items shared to a workspace cannot be marked private.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 2 and 80),
  slug          text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 40),
  billing_email text not null check (billing_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(billing_email) <= 254),
  seat_limit    int  not null default 5 check (seat_limit between 1 and 5000),      -- set by your billing webhook (service role); never by clients
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create table if not exists org_members (
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('owner','admin','editor','viewer')),
  joined_at  timestamptz not null default now(),
  invited_by uuid references auth.users(id) on delete set null,
  primary key (org_id, user_id)
);
create index if not exists org_members_user_idx on org_members (user_id);

alter table oneclist_items add column if not exists org_id uuid references organizations(id) on delete restrict;
alter table stacks         add column if not exists org_id uuid references organizations(id) on delete restrict;
create index if not exists oneclist_items_org_idx on oneclist_items (org_id, created_at desc) where org_id is not null;
create unique index if not exists oneclist_items_org_urlkey_uq on oneclist_items (org_id, url_key) where org_id is not null;
create index if not exists stacks_org_idx on stacks (org_id) where org_id is not null;

create table if not exists org_mcp_tokens (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 60),
  prefix       text not null check (char_length(prefix) = 6),                 -- first characters after buk_org_, for recognition in the UI
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),    -- sha256 of the token; the token itself is never stored
  created_by   uuid references auth.users(id) on delete set null,
  scopes       text[] not null default '{read}' check (cardinality(scopes) >= 1 and scopes <@ array['read']::text[]),   -- widen here when a write tool ships
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz
);
create index if not exists org_mcp_tokens_org_idx on org_mcp_tokens (org_id);
create table if not exists org_mcp_burst (token_id uuid not null references org_mcp_tokens(id) on delete cascade, minute timestamptz not null, n int not null default 0, primary key (token_id, minute));
create table if not exists org_mcp_usage (org_id uuid not null references organizations(id) on delete cascade, period date not null, requests int not null default 0 check (requests >= 0), primary key (org_id, period));

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Role helpers. is_org_member is what every policy calls.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function org_role_rank(r text) returns int language sql immutable as
$$ select case r when 'viewer' then 1 when 'editor' then 2 when 'admin' then 3 when 'owner' then 4 end $$;

create or replace function org_role_of(p_org uuid, p_user uuid) returns text language sql stable security definer set search_path = public as
$$ select role from org_members where org_id = p_org and user_id = p_user $$;

-- Does the CURRENT user (auth.uid()) hold at least `required_role` in this workspace? Anonymous / unknown org / non-member -> false.
-- An unknown role name raises, so a typo in a policy fails loudly in tests instead of silently denying (or allowing) access.
create or replace function is_org_member(p_org uuid, required_role text default 'viewer') returns boolean
language plpgsql stable security definer set search_path = public as $$
declare need int := org_role_rank(required_role); have int;
begin
  if need is null then raise exception 'invalid_role'; end if;
  if p_org is null or auth.uid() is null then return false; end if;
  have := org_role_rank(org_role_of(p_org, auth.uid()));
  return have is not null and have >= need;
end $$;

-- Internal switch for the definer functions below (succession, cleanup). Triggers stand down while it is '1'.
create or replace function _org_internal() returns boolean language sql stable as $$ select coalesce(current_setting('bukmarkz.org_internal', true), '') = '1' $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Membership guard (the only way roles change). Fires for every client and every server path.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function org_members_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid(); a_rank int; seats int; cnt int; org_gone boolean; user_gone boolean;
begin
  if _org_internal() then return case tg_op when 'DELETE' then old else new end; end if;

  if tg_op = 'INSERT' then
    new.joined_at := now();
    select seat_limit into seats from organizations where id = new.org_id;
    if actor is not null then
      if not exists (select 1 from org_members where org_id = new.org_id) then
        -- bootstrap: the very first member must be the creator, as owner (create_org does exactly this)
        if not (new.role = 'owner' and new.user_id = actor and exists (select 1 from organizations where id = new.org_id and created_by = actor)) then
          raise exception 'forbidden' using errcode = '42501';
        end if;
        return new;
      end if;
      a_rank := org_role_rank(org_role_of(new.org_id, actor));
      if a_rank is null or a_rank < 3 then raise exception 'forbidden' using errcode = '42501'; end if;
      if a_rank < 4 and org_role_rank(new.role) >= a_rank then raise exception 'forbidden: admins can add editors and viewers only' using errcode = '42501'; end if;
      new.invited_by := actor;
    end if;
    select count(*) into cnt from org_members where org_id = new.org_id;
    if seats is not null and cnt >= seats then raise exception 'seat_limit_reached' using errcode = '23514'; end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.org_id <> old.org_id or new.user_id <> old.user_id or new.joined_at <> old.joined_at then       -- invited_by may be nulled by its FK when the inviter's account is deleted; clients cannot write it (column grants)
      raise exception 'immutable_column' using errcode = '42501';
    end if;
    if new.role = old.role then return new; end if;
    if actor is not null then
      if actor = old.user_id then raise exception 'cannot_change_own_role' using errcode = '42501'; end if;
      a_rank := org_role_rank(org_role_of(old.org_id, actor));
      if a_rank is null or a_rank < 3 then raise exception 'forbidden' using errcode = '42501'; end if;
      if a_rank < 4 and (org_role_rank(old.role) >= a_rank or org_role_rank(new.role) >= a_rank) then raise exception 'forbidden: admins manage editors and viewers only' using errcode = '42501'; end if;
    end if;
    if old.role = 'owner' and new.role <> 'owner' and not exists (select 1 from org_members where org_id = old.org_id and role = 'owner' and user_id <> old.user_id) then
      raise exception 'last_owner' using errcode = '23514';
    end if;
    return new;
  end if;

  -- DELETE
  org_gone := not exists (select 1 from organizations where id = old.org_id);
  if org_gone then return old; end if;
  user_gone := not exists (select 1 from auth.users where id = old.user_id);
  if actor is not null and actor <> old.user_id then
    a_rank := org_role_rank(org_role_of(old.org_id, actor));
    if a_rank is null or a_rank < 3 then raise exception 'forbidden' using errcode = '42501'; end if;
    if a_rank < 4 and org_role_rank(old.role) >= a_rank then raise exception 'forbidden: admins remove editors and viewers only' using errcode = '42501'; end if;
  end if;
  if old.role = 'owner' and not user_gone and not exists (select 1 from org_members where org_id = old.org_id and role = 'owner' and user_id <> old.user_id) then
    raise exception 'last_owner' using errcode = '23514';
  end if;
  return old;
end $$;
drop trigger if exists org_members_guard_trg on org_members;
create trigger org_members_guard_trg before insert or update or delete on org_members for each row execute function org_members_guard();

-- Someone left, was removed, or was demoted: their shared work stays with the workspace and their tokens stop working.
create or replace function org_reassign_work(p_org uuid, p_from uuid, p_to uuid) returns void language plpgsql security definer set search_path = public as $$
declare r record; prev text := coalesce(current_setting('bukmarkz.org_internal', true), '');
begin
  perform set_config('bukmarkz.org_internal', '1', true);
  for r in select id from oneclist_items where org_id = p_org and user_id = p_from loop
    begin update oneclist_items set user_id = p_to where id = r.id;
    exception when unique_violation then update oneclist_items set user_id = p_to, url_key = url_key || '#org-' || id where id = r.id;   -- the new owner already holds this URL personally
    end;
  end loop;
  update stacks set user_id = p_to where org_id = p_org and user_id = p_from;
  perform set_config('bukmarkz.org_internal', prev, true);
end $$;

create or replace function org_members_after_delete() returns trigger language plpgsql security definer set search_path = public as $$
declare heir uuid;
begin
  if _org_internal() or not exists (select 1 from organizations where id = old.org_id) then return old; end if;       -- bulk deletes by org_delete / account deletion do their own cleanup
  update org_mcp_tokens set revoked_at = now() where org_id = old.org_id and created_by = old.user_id and revoked_at is null;
  select user_id into heir from org_members where org_id = old.org_id order by org_role_rank(role) desc, joined_at, user_id limit 1;   -- best remaining member
  if heir is null then return old; end if;
  perform set_config('bukmarkz.org_internal', '1', true);
  if not exists (select 1 from org_members where org_id = old.org_id and role = 'owner') then update org_members set role = 'owner' where org_id = old.org_id and user_id = heir; end if;
  perform set_config('bukmarkz.org_internal', '', true);
  select user_id into heir from org_members where org_id = old.org_id and role = 'owner' order by joined_at, user_id limit 1;
  perform org_reassign_work(old.org_id, old.user_id, heir);
  return old;
end $$;
drop trigger if exists org_members_after_delete_trg on org_members;
create trigger org_members_after_delete_trg after delete on org_members for each row execute function org_members_after_delete();

create or replace function org_members_after_update() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if org_role_rank(new.role) < 3 and org_role_rank(old.role) >= 3 then       -- no longer an admin: their workspace tokens die with the role
    update org_mcp_tokens set revoked_at = now() where org_id = new.org_id and created_by = new.user_id and revoked_at is null;
  end if;
  return new;
end $$;
drop trigger if exists org_members_after_update_trg on org_members;
create trigger org_members_after_update_trg after update of role on org_members for each row execute function org_members_after_update();

-- Deleting an account must not take team data with it: succession first (promote an heir, reassign work), or dissolve a workspace they were alone in.
create or replace function org_user_deleting() returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select org_id from org_members where user_id = old.id loop
    if not exists (select 1 from org_members where org_id = r.org_id and user_id <> old.id) then
      perform set_config('bukmarkz.org_internal', '1', true);
      delete from oneclist_items where org_id = r.org_id;
      delete from stacks where org_id = r.org_id;
      delete from org_members where org_id = r.org_id;
      delete from organizations where id = r.org_id;
      perform set_config('bukmarkz.org_internal', '', true);
    else
      if not exists (select 1 from org_members where org_id = r.org_id and role = 'owner' and user_id <> old.id) then      -- sole owner: promote the best remaining member first
        perform set_config('bukmarkz.org_internal', '1', true);
        update org_members set role = 'owner' where org_id = r.org_id and user_id = (
          select user_id from org_members where org_id = r.org_id and user_id <> old.id order by org_role_rank(role) desc, joined_at, user_id limit 1);
        perform set_config('bukmarkz.org_internal', '', true);
      end if;
      delete from org_members where org_id = r.org_id and user_id = old.id;        -- after-delete trigger reassigns their work to an owner
    end if;
  end loop;
  return old;
end $$;
drop trigger if exists org_user_deleting_trg on auth.users;
create trigger org_user_deleting_trg before delete on auth.users for each row execute function org_user_deleting();

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Workspace changes by clients: only name / slug / billing_email, only by admins. Everything else is server-only.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function organizations_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if _org_internal() or auth.uid() is null then return new; end if;
  if new.id <> old.id or new.seat_limit <> old.seat_limit or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
    raise exception 'immutable_column' using errcode = '42501';
  end if;
  if not is_org_member(old.id, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  return new;
end $$;
drop trigger if exists organizations_guard_trg on organizations;
create trigger organizations_guard_trg before update on organizations for each row execute function organizations_guard();

-- Billing hook: tighten this to "team plan only" (e.g. effective_plan from 016) when seats are sold. Default: any signed-in user may create up to 3 workspaces.
create or replace function org_creation_allowed(p_user uuid) returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if to_regprocedure('effective_plan(uuid)') is not null then return effective_plan(p_user) = 'team'; end if;
  return true;
end $$;

create or replace function create_org(p_name text, p_slug text, p_billing_email text) returns organizations
language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid(); o organizations;
begin
  if actor is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not org_creation_allowed(actor) then raise exception 'team_plan_required' using errcode = '42501'; end if;
  if (select count(*) from organizations where created_by = actor) >= 3 then raise exception 'org_limit_reached' using errcode = '23514'; end if;
  insert into organizations (name, slug, billing_email, created_by) values (btrim(p_name), lower(btrim(p_slug)), btrim(p_billing_email), actor) returning * into o;
  insert into org_members (org_id, user_id, role) values (o.id, actor, 'owner');
  return o;
end $$;

create or replace function org_add_member_by_email(p_org uuid, p_email text, p_role text default 'viewer') returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not is_org_member(p_org, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  select id into uid from auth.users where lower(email) = lower(btrim(p_email));
  if uid is null then raise exception 'user_not_found' using errcode = 'P0002'; end if;     -- admins can tell whether an address has an account; swap for an invite email flow if that matters
  insert into org_members (org_id, user_id, role) values (p_org, uid, p_role);               -- the guard trigger re-checks everything
  return uid;
end $$;

create or replace function org_list_members(p_org uuid) returns table (user_id uuid, email text, role text, joined_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare is_admin boolean;
begin
  if not is_org_member(p_org, 'viewer') then raise exception 'forbidden' using errcode = '42501'; end if;
  is_admin := is_org_member(p_org, 'admin');
  return query select m.user_id, case when is_admin or m.user_id = auth.uid() then u.email::text end, m.role, m.joined_at
    from org_members m join auth.users u on u.id = m.user_id where m.org_id = p_org order by org_role_rank(m.role) desc, m.joined_at;
end $$;

-- Owner-only. Removes the workspace's items and stacks too (they belong to it), so export first.
create or replace function org_delete(p_org uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_org_member(p_org, 'owner') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform set_config('bukmarkz.org_internal', '1', true);
  delete from oneclist_items where org_id = p_org;
  delete from stacks where org_id = p_org;
  delete from org_members where org_id = p_org;
  delete from organizations where id = p_org;
  perform set_config('bukmarkz.org_internal', '', true);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Item and stack guards: who may move data into or out of a workspace.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function org_items_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid();
begin
  if actor is null or _org_internal() then return new; end if;
  if tg_op = 'INSERT' then
    if new.user_id <> actor or not is_org_member(new.org_id, 'editor') then raise exception 'forbidden' using errcode = '42501'; end if;
  else
    if new.user_id is distinct from old.user_id then raise exception 'owner_immutable' using errcode = '42501'; end if;
    if new.org_id is distinct from old.org_id then
      if old.org_id is null then
        if old.user_id <> actor then raise exception 'forbidden' using errcode = '42501'; end if;                         -- only the owner can share a personal item
      elsif not is_org_member(old.org_id, 'admin') or old.user_id <> actor then
        raise exception 'forbidden: leaving a workspace needs an admin who is also the author' using errcode = '42501';   -- an editor cannot walk team data into a personal vault
      end if;
      if new.org_id is not null and not is_org_member(new.org_id, 'editor') then raise exception 'forbidden' using errcode = '42501'; end if;
    elsif not is_org_member(new.org_id, 'editor') then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;
  if new.org_id is not null and coalesce(new.is_private, false) then raise exception 'private_item_cannot_be_shared' using errcode = '23514'; end if;
  return new;
end $$;
drop trigger if exists org_items_guard_ins on oneclist_items;
drop trigger if exists org_items_guard_upd on oneclist_items;
create trigger org_items_guard_ins before insert on oneclist_items for each row when (new.org_id is not null) execute function org_items_guard();
create trigger org_items_guard_upd before update on oneclist_items for each row when (old.org_id is not null or new.org_id is not null) execute function org_items_guard();

create or replace function org_stacks_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid();
begin
  if actor is null or _org_internal() then return new; end if;
  if tg_op = 'INSERT' then
    if new.user_id <> actor or not is_org_member(new.org_id, 'editor') then raise exception 'forbidden' using errcode = '42501'; end if;
  else
    if new.user_id is distinct from old.user_id then raise exception 'owner_immutable' using errcode = '42501'; end if;
    if new.org_id is distinct from old.org_id then
      if old.org_id is null then
        if old.user_id <> actor then raise exception 'forbidden' using errcode = '42501'; end if;
      elsif not is_org_member(old.org_id, 'admin') or old.user_id <> actor then
        raise exception 'forbidden' using errcode = '42501';
      end if;
      if new.org_id is not null and not is_org_member(new.org_id, 'editor') then raise exception 'forbidden' using errcode = '42501'; end if;
    elsif not is_org_member(new.org_id, 'editor') then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;
  -- publishing a team stack to the open web is an admin decision
  if new.org_id is not null and new.is_public and (tg_op = 'INSERT' or not old.is_public or old.org_id is distinct from new.org_id) and not is_org_member(new.org_id, 'admin') then
    raise exception 'forbidden: only admins can make a team stack public' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists org_stacks_guard_ins on stacks;
drop trigger if exists org_stacks_guard_upd on stacks;
create trigger org_stacks_guard_ins before insert on stacks for each row when (new.org_id is not null) execute function org_stacks_guard();
create trigger org_stacks_guard_upd before update on stacks for each row when (old.org_id is not null or new.org_id is not null) execute function org_stacks_guard();

-- stacks.org_id is not client-writable (column grants from 012); sharing a stack goes through here. The guard re-checks.
create or replace function move_stack_to_org(p_stack uuid, p_org uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  update stacks set org_id = p_org, is_public = false where id = p_stack and user_id = auth.uid() and org_id is null;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

-- Workspace tokens: the creator must be an admin right now, at most 10 live tokens per workspace. (Server-side, via org_issue_token.)
create or replace function org_tokens_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if org_role_rank(org_role_of(new.org_id, new.created_by)) is null or org_role_rank(org_role_of(new.org_id, new.created_by)) < 3 then raise exception 'forbidden' using errcode = '42501'; end if;
  if (select count(*) from org_mcp_tokens where org_id = new.org_id and revoked_at is null and (expires_at is null or expires_at > now())) >= 10 then raise exception 'too_many_tokens' using errcode = '23514'; end if;
  return new;
end $$;
drop trigger if exists org_tokens_guard_trg on org_mcp_tokens;
create trigger org_tokens_guard_trg before insert on org_mcp_tokens for each row execute function org_tokens_guard();

-- Hole closed: create_stack (010) copies a user's own items into a stack that is PUBLIC by default, and "own" would now include items they authored in a
-- workspace. Team items must never be published by that path (publishing a team stack is an admin decision, see org_stacks_guard). Same function, one extra filter.
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
    join oneclist_items o on o.user_id = uid and o.org_id is null
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

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------------------------------------------------------
alter table organizations enable row level security;
alter table org_members enable row level security;
alter table org_mcp_tokens enable row level security;
alter table org_mcp_burst enable row level security;
alter table org_mcp_usage enable row level security;
revoke all on organizations, org_members, org_mcp_tokens, org_mcp_burst, org_mcp_usage from anon, authenticated;

drop policy if exists organizations_member on organizations;
create policy organizations_member on organizations for select to authenticated using (is_org_member(id, 'viewer'));
drop policy if exists organizations_admin on organizations;
create policy organizations_admin on organizations for update to authenticated using (is_org_member(id, 'admin')) with check (is_org_member(id, 'admin'));
grant select on organizations to authenticated;
grant update (name, slug, billing_email) on organizations to authenticated;                        -- no insert (create_org), no delete (org_delete)

drop policy if exists org_members_read on org_members;
create policy org_members_read on org_members for select to authenticated using (is_org_member(org_id, 'viewer'));
drop policy if exists org_members_write on org_members;
create policy org_members_write on org_members for insert to authenticated with check (is_org_member(org_id, 'admin'));
drop policy if exists org_members_change on org_members;
create policy org_members_change on org_members for update to authenticated using (is_org_member(org_id, 'admin')) with check (is_org_member(org_id, 'admin'));
drop policy if exists org_members_remove on org_members;
create policy org_members_remove on org_members for delete to authenticated using (is_org_member(org_id, 'admin') or user_id = auth.uid());
grant select, delete on org_members to authenticated;
grant insert (org_id, user_id, role) on org_members to authenticated;
grant update (role) on org_members to authenticated;

drop policy if exists org_mcp_tokens_admin on org_mcp_tokens;
create policy org_mcp_tokens_admin on org_mcp_tokens for select to authenticated using (is_org_member(org_id, 'admin'));
grant select (id, org_id, name, prefix, created_by, scopes, created_at, last_used_at, expires_at, revoked_at) on org_mcp_tokens to authenticated;   -- never token_hash

-- Items. Personal rows keep working exactly as before; shared rows follow the workspace role.
drop policy if exists items_own on oneclist_items;
drop policy if exists items_own_personal on oneclist_items;
create policy items_own_personal on oneclist_items for all to authenticated
  using (user_id = auth.uid() and org_id is null) with check (user_id = auth.uid() and org_id is null);
drop policy if exists items_org_read on oneclist_items;
create policy items_org_read on oneclist_items for select to authenticated using (org_id is not null and is_org_member(org_id, 'viewer'));
drop policy if exists items_org_insert on oneclist_items;
create policy items_org_insert on oneclist_items for insert to authenticated with check (org_id is not null and user_id = auth.uid() and is_org_member(org_id, 'editor'));
drop policy if exists items_org_update on oneclist_items;
create policy items_org_update on oneclist_items for update to authenticated using (org_id is not null and is_org_member(org_id, 'editor')) with check (org_id is not null and is_org_member(org_id, 'editor'));
drop policy if exists items_org_delete on oneclist_items;
create policy items_org_delete on oneclist_items for delete to authenticated
  using (org_id is not null and (is_org_member(org_id, 'admin') or (user_id = auth.uid() and is_org_member(org_id, 'editor'))));

-- Stacks (same shape; creation stays in create_stack, sharing in move_stack_to_org).
drop policy if exists stacks_owner on stacks;
create policy stacks_owner on stacks for all to authenticated using (user_id = auth.uid() and org_id is null) with check (user_id = auth.uid() and org_id is null and is_blocked = false);
drop policy if exists stacks_org_read on stacks;
create policy stacks_org_read on stacks for select to authenticated using (org_id is not null and is_org_member(org_id, 'viewer'));
drop policy if exists stacks_org_update on stacks;
create policy stacks_org_update on stacks for update to authenticated using (org_id is not null and is_org_member(org_id, 'editor') and is_blocked = false) with check (org_id is not null and is_org_member(org_id, 'editor') and is_blocked = false);
drop policy if exists stacks_org_delete on stacks;
create policy stacks_org_delete on stacks for delete to authenticated using (org_id is not null and (is_org_member(org_id, 'admin') or (user_id = auth.uid() and is_org_member(org_id, 'editor'))));

drop policy if exists stack_items_owner on stack_items;
create policy stack_items_owner on stack_items for all to authenticated
  using (exists (select 1 from stacks s where s.id = stack_id and s.user_id = auth.uid() and s.org_id is null))
  with check (exists (select 1 from stacks s where s.id = stack_id and s.user_id = auth.uid() and s.org_id is null));
drop policy if exists stack_items_org_read on stack_items;
create policy stack_items_org_read on stack_items for select to authenticated using (exists (select 1 from stacks s where s.id = stack_id and s.org_id is not null and is_org_member(s.org_id, 'viewer')));
drop policy if exists stack_items_org_write on stack_items;
create policy stack_items_org_write on stack_items for all to authenticated
  using (exists (select 1 from stacks s where s.id = stack_id and s.org_id is not null and is_org_member(s.org_id, 'editor')))
  with check (exists (select 1 from stacks s where s.id = stack_id and s.org_id is not null and is_org_member(s.org_id, 'editor')));

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. Org MCP (server-side only: service role)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function org_issue_token(p_actor uuid, p_org uuid, p_name text, p_hash text, p_prefix text, p_scopes text[] default '{read}', p_expires_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  insert into org_mcp_tokens (org_id, name, prefix, token_hash, created_by, scopes, expires_at)
  values (p_org, btrim(p_name), p_prefix, p_hash, p_actor, coalesce(p_scopes, '{read}'), p_expires_at) returning id into tid;      -- org_tokens_guard checks the actor
  return tid;
end $$;

create or replace function org_revoke_token(p_actor uuid, p_org uuid, p_token uuid) returns boolean language plpgsql security definer set search_path = public as $$
begin
  if coalesce(org_role_rank(org_role_of(p_org, p_actor)), 0) < 3 then raise exception 'forbidden' using errcode = '42501'; end if;
  update org_mcp_tokens set revoked_at = now() where id = p_token and org_id = p_org and revoked_at is null;
  return found;
end $$;

-- The token is only as strong as the person who made it: it stops working the moment its creator is no longer an admin of that workspace.
create or replace function org_mcp_authenticate(p_hash text)
returns table (org_id uuid, token_id uuid, scopes text[], created_by uuid, org_name text, seat_limit int) language plpgsql security definer set search_path = public as $$
begin
  return query
  select t.org_id, t.id, t.scopes, t.created_by, o.name, o.seat_limit
  from org_mcp_tokens t join organizations o on o.id = t.org_id
  where t.token_hash = p_hash and t.revoked_at is null and (t.expires_at is null or t.expires_at > now())
    and t.created_by is not null and coalesce(org_role_rank(org_role_of(t.org_id, t.created_by)), 0) >= 3;
  update org_mcp_tokens set last_used_at = now() where token_hash = p_hash and revoked_at is null and (last_used_at is null or last_used_at < now() - interval '1 minute');
end $$;

create or replace function org_mcp_meter(p_org uuid, p_token uuid, p_monthly_limit int, p_burst_limit int default 60) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m timestamptz := date_trunc('minute', now()); b int; used int; per date := date_trunc('month', now() at time zone 'utc')::date;
begin
  delete from org_mcp_burst where token_id = p_token and minute < now() - interval '1 hour';
  insert into org_mcp_burst (token_id, minute, n) values (p_token, m, 1) on conflict (token_id, minute) do update set n = org_mcp_burst.n + 1 returning n into b;
  if b > p_burst_limit then
    return jsonb_build_object('allowed', false, 'reason', 'burst', 'retry_after', greatest(1, ceil(extract(epoch from (m + interval '1 minute' - now())))::int));
  end if;
  insert into org_mcp_usage as u (org_id, period, requests) values (p_org, per, 1)
    on conflict (org_id, period) do update set requests = u.requests + 1 where p_monthly_limit is null or u.requests < p_monthly_limit returning u.requests into used;
  if used is null then
    select requests into used from org_mcp_usage where org_id = p_org and period = per;
    return jsonb_build_object('allowed', false, 'reason', 'monthly', 'used', coalesce(used, 0), 'limit', p_monthly_limit);
  end if;
  return jsonb_build_object('allowed', true, 'used', used, 'limit', p_monthly_limit);
end $$;
create or replace function org_mcp_unmeter(p_org uuid) returns void language sql security definer set search_path = public as $$
  update org_mcp_usage set requests = greatest(requests - 1, 0) where org_id = p_org and period = date_trunc('month', now() at time zone 'utc')::date;
$$;

-- Hybrid (semantic + keyword, RRF) search restricted to ONE workspace. p_org comes from the verified token, never from the caller's arguments.
-- query_embedding may be NULL (embeddings down): keyword leg only. Items marked private or skipped_private never appear.
create or replace function match_org_items(
  p_org uuid, query_embedding vector default null, match_threshold float default 0.25, match_count int default 8, query_text text default null,
  embedding_model_param text default null, semantic_weight float default 1.0, keyword_weight float default 1.0, rrf_k int default 50)
returns table (id uuid, org_id uuid, url text, title text, summary text, note text, tags text[], ai_tags text[], similarity float, score float, match_type text, created_at timestamptz)
language plpgsql stable security invoker set search_path = public, extensions as $$
declare v_n int := greatest(1, least(coalesce(match_count, 8), 50)); v_q tsquery; v_pool int;
begin
  if p_org is null then raise exception 'p_org is required' using errcode = '22004'; end if;
  v_pool := v_n * 4;
  if nullif(btrim(query_text), '') is not null then v_q := websearch_to_tsquery('english', query_text); end if;
  begin perform set_config('hnsw.ef_search', '100', true); perform set_config('hnsw.iterative_scan', 'relaxed_order', true); exception when others then null; end;
  return query
  with sem as (
    select s.id, s.sim, row_number() over (order by s.sim desc, s.id) as rnk from (
      select i.id, 1 - (i.embedding <=> query_embedding) as sim from oneclist_items i
      where query_embedding is not null and i.org_id = p_org and i.embedding is not null and not coalesce(i.is_private, false) and coalesce(i.ai_status, '') <> 'skipped_private'
        and (embedding_model_param is null or i.embedding_model = embedding_model_param)
      order by i.embedding <=> query_embedding limit v_pool) s
    where s.sim >= coalesce(match_threshold, 0)
  ), kw as (
    select k.id, k.tr, row_number() over (order by k.tr desc, k.id) as rnk from (
      select i.id, ts_rank_cd(i.fts, v_q, 32) as tr from oneclist_items i
      where v_q is not null and i.org_id = p_org and i.fts @@ v_q and not coalesce(i.is_private, false) and coalesce(i.ai_status, '') <> 'skipped_private'
      order by ts_rank_cd(i.fts, v_q, 32) desc limit v_pool) k
  ), fused as (
    select coalesce(sem.id, kw.id) as id, sem.sim, coalesce(semantic_weight / (rrf_k + sem.rnk), 0) + coalesce(keyword_weight / (rrf_k + kw.rnk), 0) as score,
           case when sem.id is not null and kw.id is not null then 'both' when sem.id is not null then 'semantic' else 'keyword' end as mt
    from sem full outer join kw on kw.id = sem.id
  )
  select i.id, i.org_id, i.url, i.title, i.summary, left(i.note, 2000), i.tags, i.ai_tags, coalesce(f.sim, 0)::float, f.score::float, f.mt, i.created_at
  from fused f join oneclist_items i on i.id = f.id and i.org_id = p_org
  order by f.score desc, i.created_at desc limit v_n;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 8. Function privileges
-- ---------------------------------------------------------------------------------------------------------------------
revoke all on function org_role_of(uuid, uuid), org_reassign_work(uuid, uuid, uuid), org_creation_allowed(uuid), _org_internal(),
  org_issue_token(uuid, uuid, text, text, text, text[], timestamptz), org_revoke_token(uuid, uuid, uuid), org_mcp_authenticate(text),
  org_mcp_meter(uuid, uuid, int, int), org_mcp_unmeter(uuid), match_org_items(uuid, vector, float, int, text, text, float, float, int) from public, anon, authenticated;
grant execute on function org_role_of(uuid, uuid), org_issue_token(uuid, uuid, text, text, text, text[], timestamptz), org_revoke_token(uuid, uuid, uuid), org_mcp_authenticate(text),
  org_mcp_meter(uuid, uuid, int, int), org_mcp_unmeter(uuid), match_org_items(uuid, vector, float, int, text, text, float, float, int) to service_role;
revoke all on function is_org_member(uuid, text), org_role_rank(text), create_org(text, text, text), org_add_member_by_email(uuid, text, text), org_list_members(uuid), org_delete(uuid), move_stack_to_org(uuid, uuid) from public, anon;
grant execute on function is_org_member(uuid, text), org_role_rank(text) to authenticated, service_role;      -- policies call these as the signed-in user
grant execute on function create_org(text, text, text), org_add_member_by_email(uuid, text, text), org_list_members(uuid), org_delete(uuid), move_stack_to_org(uuid, uuid) to authenticated;
