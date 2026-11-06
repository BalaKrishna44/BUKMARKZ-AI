-- 028: Focus Session Stacks ("Flush Session" in the extension). One row per flushed browser window.
-- Sharing model: "anyone with the link" (uuid = 122 random bits, noindex), revocable with shared = false. Flip the default below to make sessions private-by-default.
-- Writes use the signed-in user's own JWT (RLS), like /api/ingest. Public reads go through get_shared_session() so user_id is never exposed.

create table if not exists sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 120),
  summary     text check (summary is null or char_length(summary) <= 600),
  tabs        jsonb not null check (jsonb_typeof(tabs) = 'array' and jsonb_array_length(tabs) between 1 and 200 and pg_column_size(tabs) <= 400000),
  tab_count   int  not null check (tab_count between 1 and 200),
  shared      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists sessions_user_idx on sessions (user_id, created_at desc);

alter table sessions enable row level security;
revoke all on sessions from anon, authenticated;
grant select, delete on sessions to authenticated;
grant insert (title, tabs, tab_count, shared, user_id) on sessions to authenticated;
grant update (title, summary, shared) on sessions to authenticated;
drop policy if exists sessions_own on sessions;
create policy sessions_own on sessions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 20 flushes per user per hour: a stuck client or a stolen token cannot fill the table.
create or replace function sessions_rate_limit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from sessions where user_id = new.user_id and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  return new;
end $$;
drop trigger if exists sessions_rate_limit_trg on sessions;
create trigger sessions_rate_limit_trg before insert on sessions for each row execute function sessions_rate_limit();

-- Public, link-only read. No user_id, nothing for unshared sessions.
create or replace function get_shared_session(p_id uuid) returns table (id uuid, title text, summary text, tabs jsonb, tab_count int, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, s.title, s.summary, s.tabs, s.tab_count, s.created_at from sessions s where s.id = p_id and s.shared
$$;
revoke all on function get_shared_session(uuid), sessions_rate_limit() from public;
grant execute on function get_shared_session(uuid) to anon, authenticated, service_role;
