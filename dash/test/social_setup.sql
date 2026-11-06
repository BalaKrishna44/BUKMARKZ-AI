-- Minimal Supabase stand-ins so 010/012 run on plain PostgreSQL (test only).
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated;
grant select on auth.users to authenticated;
create table oneclist_items (id uuid primary key default gen_random_uuid(), user_id uuid not null, url text not null, url_key text not null, title text, tags text[], source text, status text, ai_status text, unique (user_id, url_key));
grant select, insert, update, delete on oneclist_items to authenticated;
