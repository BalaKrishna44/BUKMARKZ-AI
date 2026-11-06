\set ON_ERROR_STOP on
set client_min_messages = notice;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth; create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated;
\i ../../sql/028_sessions.sql
\i ../../sql/028_sessions.sql
create function ok(c boolean, m text) returns void language plpgsql as $$ begin if c is not true then raise exception 'FAIL: %', m; end if; raise notice 'ok   %', m; end $$;
create function fails(q text, frag text) returns boolean language plpgsql as $$ begin execute q; return false; exception when others then return position(frag in sqlerrm || ' ' || sqlstate) > 0; end $$;
grant execute on function ok(boolean, text), fails(text, text) to anon, authenticated;
insert into auth.users values ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000b1');
\set asA 'reset role; select set_config(''request.jwt.claim.sub'', ''00000000-0000-0000-0000-0000000000a1'', false) as _; set role authenticated;'
\set asB 'reset role; select set_config(''request.jwt.claim.sub'', ''00000000-0000-0000-0000-0000000000b1'', false) as _; set role authenticated;'
\set asANON 'reset role; select set_config(''request.jwt.claim.sub'', '''', false) as _; set role anon;'

:asA
insert into sessions(user_id, title, tabs, tab_count) values (auth.uid(), 'Mine', '[{"url":"https://a.example/","title":"A","favicon":null}]', 1) returning id as s1 \gset
select ok(true, 'owner can insert a session');
select ok(fails($$insert into sessions(user_id, title, tabs, tab_count) values ('00000000-0000-0000-0000-0000000000b1', 'forged', '[{"u":1}]', 1)$$, '42501'), 'cannot insert for someone else');
select ok(fails($$insert into sessions(user_id, title, tabs, tab_count) values (auth.uid(), 'x', '[]', 1)$$, 'check'), 'empty tab list rejected');
select ok(fails($$insert into sessions(user_id, title, tabs, tab_count) select auth.uid(), 'x', jsonb_agg(jsonb_build_object('u', g)), 201 from generate_series(1, 201) g$$, 'check'), 'more than 200 tabs rejected');
select ok(fails($$insert into sessions(user_id, title, tabs, tab_count) values (auth.uid(), 'x', '{"a":1}', 1)$$, 'check'), 'tabs must be an array');
select ok(fails($$update sessions set user_id = '00000000-0000-0000-0000-0000000000b1'$$, '42501'), 'owner column is not updatable');
select ok(fails($$update sessions set tabs = '[{"x":1}]'$$, '42501'), 'tabs are immutable after saving');
update sessions set summary = 'You were researching.';
select ok((select summary from sessions) = 'You were researching.', 'owner can set the summary');
:asB
select ok((select count(*) from sessions) = 0, 'other users cannot read it through the table');
with u as (update sessions set shared = false returning 1) select ok((select count(*) from u) = 0, 'other users cannot unshare it');
with d as (delete from sessions returning 1) select ok((select count(*) from d) = 0, 'other users cannot delete it');
:asANON
select ok(fails($$select * from sessions$$, '42501'), 'anon has no table access');
select ok((select count(*) from get_shared_session(:'s1')) = 1, 'anon can read a shared session by its link');
select ok((select to_jsonb(g) ? 'user_id' from get_shared_session(:'s1') g) = false, 'public read never exposes user_id');
:asA
update sessions set shared = false where id = :'s1';
:asANON
select ok((select count(*) from get_shared_session(:'s1')) = 0, 'unshared session is invisible to the public');
select ok((select count(*) from get_shared_session(gen_random_uuid())) = 0, 'unknown id: nothing');
:asA
-- rate limit: 20 per hour (1 already inserted above)
insert into sessions(user_id, title, tabs, tab_count) select auth.uid(), 'bulk', '[{"u":1}]', 1 from generate_series(1, 19);
select ok(fails($$insert into sessions(user_id, title, tabs, tab_count) values (auth.uid(), 'over', '[{"u":1}]', 1)$$, 'rate_limited'), '21st flush within an hour is refused');
select ok((select count(*) from sessions) = 20, 'exactly 20 stored');
