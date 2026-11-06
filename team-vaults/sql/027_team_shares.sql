-- 027: "tag a colleague" invites. Builds on 017_team_vaults.sql (organizations, org_members, oneclist_items.org_id, guard triggers).
-- Sharing an item = moving it into a workspace (oneclist_items.org_id); the colleague is invited by email and joins as a VIEWER only after accepting.
-- Everything is service-role only: the Server Action verifies the session user and passes it in as p_actor. Clients never write these tables.
-- Re-runnable.

create table if not exists team_shares (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  item_id       uuid not null references oneclist_items(id) on delete cascade,
  shared_by     uuid not null references auth.users(id) on delete cascade,
  invitee_email text not null check (invitee_email = lower(invitee_email) and length(invitee_email) <= 254 and invitee_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  token_hash    text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),       -- sha256 of the emailed secret; the secret itself is never stored
  status        text not null default 'pending' check (status in ('pending', 'accepted')),
  send_count    int  not null default 1,
  last_sent_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '14 days',
  accepted_by   uuid references auth.users(id) on delete set null,
  accepted_at   timestamptz
);
create unique index if not exists team_shares_pending_uq on team_shares (item_id, invitee_email) where status = 'pending';
create index if not exists team_shares_actor_day on team_shares (shared_by, created_at);

alter table team_shares enable row level security;
revoke all on team_shares from anon, authenticated;
grant select (id, org_id, item_id, shared_by, invitee_email, status, created_at, expires_at, accepted_at) on team_shares to authenticated;   -- never token_hash
drop policy if exists team_shares_read on team_shares;
create policy team_shares_read on team_shares for select using (shared_by = auth.uid() or is_org_member(org_id, 'admin'));

-- ---------------------------------------------------------------------------------------------------------------------
-- Create / re-send an invite.  outcome: created | resent | duplicate (re-tagged within 10 minutes: no new email) | member (already in the workspace: no email)
-- Errors (message): item_not_found, private_item_cannot_be_shared, org_required, forbidden, item_in_other_workspace, invalid_email, seat_limit_reached, rate_limited
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function team_share_create(p_actor uuid, p_item uuid, p_org uuid, p_email text, p_token_hash text)
returns table (share_id uuid, org_id uuid, org_name text, outcome text, send_count int, moved boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare it record; target uuid; v_email text := lower(btrim(p_email)); n int; seats int; sh record; moved boolean := false; actor_email text;
begin
  select id, user_id, org_id as item_org, coalesce(is_private, false) as priv into it from oneclist_items where id = p_item and user_id = p_actor for update;
  if not found then raise exception 'item_not_found' using errcode = 'P0002'; end if;
  if it.priv then raise exception 'private_item_cannot_be_shared' using errcode = '23514'; end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(v_email) > 254 then raise exception 'invalid_email' using errcode = '22023'; end if;
  select u.email into actor_email from auth.users u where u.id = p_actor;
  if lower(coalesce(actor_email, '')) = v_email then raise exception 'invalid_email' using errcode = '22023'; end if;       -- cannot invite yourself

  -- which workspace?  the item's own, else the one the caller named, else their only editor+ workspace
  if it.item_org is not null then
    if p_org is not null and p_org <> it.item_org then raise exception 'item_in_other_workspace' using errcode = '23514'; end if;
    target := it.item_org;
  elsif p_org is not null then target := p_org;
  else
    select count(*), min(m.org_id::text)::uuid into n, target from org_members m where m.user_id = p_actor and org_role_rank(m.role) >= 2;
    if n = 0 then raise exception 'forbidden' using errcode = '42501'; end if;
    if n > 1 then raise exception 'org_required' using errcode = '22023'; end if;
  end if;
  if coalesce(org_role_rank(org_role_of(target, p_actor)), 0) < 2 then raise exception 'forbidden' using errcode = '42501'; end if;   -- editor or above

  select count(*) into n from team_shares t where t.shared_by = p_actor and t.created_at > now() - interval '24 hours';
  if n >= 30 then raise exception 'rate_limited' using errcode = '54000'; end if;

  perform pg_advisory_xact_lock(hashtextextended(target::text, 27));                -- serialise invites per workspace (seat maths)
  select o.seat_limit into seats from organizations o where o.id = target;
  if exists (select 1 from org_members m join auth.users u on u.id = m.user_id where m.org_id = target and lower(u.email) = v_email) then
    return query select null::uuid, target, (select o.name from organizations o where o.id = target), 'member'::text, 0, false; return;
  end if;
  select count(*) into n from org_members m where m.org_id = target;
  if seats is not null and n >= seats then raise exception 'seat_limit_reached' using errcode = '23514'; end if;

  if it.item_org is null then                                                       -- the share itself: link the item to the workspace (the owner is the actor; re-checked above)
    update oneclist_items i set org_id = target where i.id = p_item and i.user_id = p_actor;
    moved := true;
  end if;

  select * into sh from team_shares t where t.item_id = p_item and t.invitee_email = v_email and t.status = 'pending' for update;
  if found then
    if sh.last_sent_at > now() - interval '10 minutes' and sh.expires_at > now() then
      return query select sh.id, target, (select o.name from organizations o where o.id = target), 'duplicate'::text, sh.send_count, moved; return;
    end if;
    update team_shares t set token_hash = p_token_hash, send_count = t.send_count + 1, last_sent_at = now(), expires_at = now() + interval '14 days', shared_by = p_actor
      where t.id = sh.id returning * into sh;
    return query select sh.id, target, (select o.name from organizations o where o.id = target), 'resent'::text, sh.send_count, moved; return;
  end if;
  insert into team_shares (org_id, item_id, shared_by, invitee_email, token_hash) values (target, p_item, p_actor, v_email, p_token_hash) returning * into sh;
  return query select sh.id, target, (select o.name from organizations o where o.id = target), 'created'::text, sh.send_count, moved;
end $$;

-- Email failed: undo what this call did, so a failed send leaves nothing half-shared.
create or replace function team_share_unsend(p_actor uuid, p_share uuid, p_was_new boolean, p_moved boolean)
returns void language plpgsql security definer set search_path = public as $$
declare sh record;
begin
  select * into sh from team_shares t where t.id = p_share and t.shared_by = p_actor and t.status = 'pending' for update;
  if not found then return; end if;
  if p_was_new then delete from team_shares t where t.id = p_share;
  else update team_shares t set last_sent_at = now() - interval '1 day' where t.id = p_share;          -- allow an immediate retry
  end if;
  if p_moved and not exists (select 1 from team_shares t where t.item_id = sh.item_id) then            -- we moved it into the workspace for this invite only: move it back
    update oneclist_items i set org_id = null where i.id = sh.item_id and i.user_id = p_actor and i.org_id = sh.org_id;
  end if;
end $$;

-- Accept: the signed-in account's email must equal the invited address. Adds a VIEWER (the 017 guard enforces seat_limit again).
create or replace function team_share_accept(p_user uuid, p_token_hash text)
returns table (org_id uuid, org_slug text, item_id uuid)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare sh record; mail text; o record;
begin
  select * into sh from team_shares t where t.token_hash = p_token_hash and t.status = 'pending' and t.expires_at > now() for update;
  if not found then raise exception 'invalid_invite' using errcode = 'P0002'; end if;
  select lower(u.email) into mail from auth.users u where u.id = p_user;
  if mail is null or mail <> sh.invitee_email then raise exception 'wrong_account' using errcode = '42501'; end if;
  if not exists (select 1 from oneclist_items i where i.id = sh.item_id and i.org_id = sh.org_id) then raise exception 'invalid_invite' using errcode = 'P0002'; end if;   -- item was un-shared or moved
  if not exists (select 1 from org_members m where m.org_id = sh.org_id and m.user_id = p_user) then
    insert into org_members (org_id, user_id, role) values (sh.org_id, p_user, 'viewer');
  end if;
  update team_shares t set status = 'accepted', accepted_by = p_user, accepted_at = now() where t.id = sh.id;
  select * into o from organizations x where x.id = sh.org_id;
  return query select sh.org_id, o.slug, sh.item_id;
end $$;

revoke all on function team_share_create(uuid, uuid, uuid, text, text), team_share_unsend(uuid, uuid, boolean, boolean), team_share_accept(uuid, text) from public, anon, authenticated;
grant execute on function team_share_create(uuid, uuid, uuid, text, text), team_share_unsend(uuid, uuid, boolean, boolean), team_share_accept(uuid, text) to service_role;
