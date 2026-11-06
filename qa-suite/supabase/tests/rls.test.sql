-- pgTAP row-level-security verification for Bukmarkz.
--   Real project :  supabase test db            (needs:  create extension if not exists pgtap with schema extensions;)
--   No pgtap     :  sh supabase/tests/_sandbox/run_local.sh   (uses _sandbox/pgtap_shim.sql, a ~40-line stand-in)
-- Everything runs in ONE transaction and is rolled back: nothing is left behind, so it is safe against a branch/staging database
-- (never point it at production: it creates auth.users rows before rolling back).
--
-- Pillars:  1) a user can never read/edit/delete another user's oneclist_items     (RLS + WITH CHECK + owner-change guard)
--           2) an org `viewer` cannot do admin things or touch MCP tokens           (policies, column grants, service-role-only RPCs)
--           3) anon reads public stacks only through get_public_stack(); private stuff is invisible to the unauthenticated
--
-- NOTE ON "public items": oneclist_items has NO public flag; a user's vault rows are never readable by anon. Anything public is a *stack*
-- (stacks.is_public) and is exposed only through the get_public_stack() RPC. This file tests exactly that design.
begin;
select plan(64);

-- ---------------------------------------------------------------- helpers (all dropped by the rollback)
create table _ids (k text primary key, v uuid); grant all on _ids to public;
create function _id(k text) returns uuid language sql stable as $$ select v from _ids where k = $1 $$;
create function _as(sub uuid) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub', sub::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', sub, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true); end $$;
create function _as_anon() returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claims', '{"role":"anon"}', true); perform set_config('role', 'anon', true); end $$;
create function _as_service() returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claims', '{"role":"service_role"}', true); perform set_config('role', 'service_role', true); end $$;
-- rows touched by a DML statement as the CURRENT role (0 when RLS hides them)
create function affected(q text) returns int language plpgsql as $$ declare n int; begin execute q; get diagnostics n = row_count; return n; end $$;
-- rows a SELECT can see as the CURRENT role; permission denied counts as "sees nothing" (both are a correct block)
create function visible(q text) returns int language plpgsql as $$ declare n int; begin execute format('select count(*) from (%s) _t', q) into n; return n;
  exception when insufficient_privilege then return 0; end $$;
-- true when the statement was refused by an error OR silently matched no rows
create function blocked(q text) returns boolean language plpgsql as $$ declare n int; begin execute q; get diagnostics n = row_count; return n = 0;
  exception when others then return true; end $$;

-- ---------------------------------------------------------------- fixtures (as the table owner; bypasses RLS)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@qa.test'), ('00000000-0000-0000-0000-0000000000b1', 'b@qa.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'owner@qa.test'), ('00000000-0000-0000-0000-0000000000c2', 'admin@qa.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'editor@qa.test'), ('00000000-0000-0000-0000-0000000000c4', 'viewer@qa.test'),
  ('00000000-0000-0000-0000-0000000000c5', 'outsider@qa.test');
insert into _ids values ('A', '00000000-0000-0000-0000-0000000000a1'), ('B', '00000000-0000-0000-0000-0000000000b1'), ('OWNER', '00000000-0000-0000-0000-0000000000c1'),
  ('ADMIN', '00000000-0000-0000-0000-0000000000c2'), ('EDITOR', '00000000-0000-0000-0000-0000000000c3'), ('VIEWER', '00000000-0000-0000-0000-0000000000c4'), ('OUT', '00000000-0000-0000-0000-0000000000c5');
insert into oneclist_items (id, user_id, url, url_key, title, is_private) values
  ('10000000-0000-0000-0000-0000000000a1', _id('A'), 'https://a.example/one',     'a.example/one',     'A public-ish link', false),
  ('10000000-0000-0000-0000-0000000000a2', _id('A'), 'https://a.example/secret',  'a.example/secret',  'A PRIVATE link',    true),
  ('10000000-0000-0000-0000-0000000000b1', _id('B'), 'https://b.example/one',     'b.example/one',     'B link',            false);

-- ================================================================ 1. USER A vs USER B (oneclist_items)
select _as(_id('A'));
select is((select count(*)::int from oneclist_items), 2, '1.1 A sees exactly their own 2 items');
select is(visible($$select 1 from oneclist_items where user_id = '00000000-0000-0000-0000-0000000000b1'$$), 0, '1.2 A cannot SELECT B''s items');
select is(affected($$update oneclist_items set title = 'pwned' where id = '10000000-0000-0000-0000-0000000000b1'$$), 0, '1.3 A cannot UPDATE B''s item');
select is(affected($$delete from oneclist_items where id = '10000000-0000-0000-0000-0000000000b1'$$), 0, '1.4 A cannot DELETE B''s item');
select throws_ok($$insert into oneclist_items (user_id, url, url_key, title) values ('00000000-0000-0000-0000-0000000000b1', 'https://x.example/', 'x.example', 'planted')$$, '42501', null, '1.5 A cannot INSERT a row owned by B');
select throws_ok($$update oneclist_items set user_id = '00000000-0000-0000-0000-0000000000b1' where id = '10000000-0000-0000-0000-0000000000a1'$$, '42501', null, '1.6 A cannot hand their own row to B (WITH CHECK)');
select is(affected($$update oneclist_items set title = 'A edited' where id = '10000000-0000-0000-0000-0000000000a1'$$), 1, '1.7 A can UPDATE their own item');
select is(affected($$delete from oneclist_items where id = '10000000-0000-0000-0000-0000000000a2'$$), 1, '1.8 A can DELETE their own item');
select ok(blocked($$update oneclist_items set org_id = gen_random_uuid() where id = '10000000-0000-0000-0000-0000000000a1'$$), '1.9 A cannot move an item into a workspace they are not in');
select is(visible($$select 1 from oneclist_items where url like '%b.example%'$$), 0, '1.10 filtering by URL does not leak B''s rows either');
reset role;
select is((select title from oneclist_items where id = '10000000-0000-0000-0000-0000000000b1'), 'B link', '1.11 B''s row is untouched after A''s attempts');
select is((select user_id from oneclist_items where id = '10000000-0000-0000-0000-0000000000a1'), _id('A'), '1.12 A''s row still belongs to A');
insert into oneclist_items (id, user_id, url, url_key, title, is_private) values ('10000000-0000-0000-0000-0000000000a2', _id('A'), 'https://a.example/secret', 'a.example/secret', 'A PRIVATE link', true);   -- restore for section 3

-- ================================================================ 2. ORG ROLES: viewer must not do admin things
select _as(_id('OWNER'));
do $$ begin
  insert into _ids select 'ORG', id from create_org('QA Inc', 'qa-inc', 'billing@qa.test');
  perform org_add_member_by_email(_id('ORG'), 'admin@qa.test', 'admin');
  perform org_add_member_by_email(_id('ORG'), 'editor@qa.test', 'editor');
  perform org_add_member_by_email(_id('ORG'), 'viewer@qa.test', 'viewer');
end $$;
insert into oneclist_items (id, user_id, org_id, url, url_key, title) values ('20000000-0000-0000-0000-000000000001', _id('OWNER'), _id('ORG'), 'https://team.example/runbook', 'team.example/runbook', 'Team runbook');
reset role;
-- a workspace token issued by the admin (service-role-only RPC), used below
do $$ begin insert into _ids select 'TOK', org_issue_token(_id('ADMIN'), _id('ORG'), 'Cursor', encode(sha256('buk_org_qa_token'::bytea), 'hex'), 'qa0001'); end $$;

select _as(_id('VIEWER'));
select is((select count(*)::int from oneclist_items where org_id = _id('ORG')), 1, '2.1 viewer CAN read workspace items');
select throws_ok($$insert into oneclist_items (user_id, org_id, url, url_key, title) values (auth.uid(), (select id from organizations limit 1), 'https://v.example/', 'v.example', 'viewer write')$$, '42501', null, '2.2 viewer cannot add workspace items');
select is(affected($$update oneclist_items set title = 'defaced' where id = '20000000-0000-0000-0000-000000000001'$$), 0, '2.3 viewer cannot edit workspace items');
select is(affected($$delete from oneclist_items where id = '20000000-0000-0000-0000-000000000001'$$), 0, '2.4 viewer cannot delete workspace items');
select is(affected($$update organizations set name = 'Hijacked'$$), 0, '2.5 viewer cannot rename the workspace');
select ok(blocked($$update org_members set role = 'owner' where user_id = auth.uid()$$), '2.6 viewer cannot promote themselves');
select ok(blocked($$insert into org_members (org_id, user_id, role) values ((select id from organizations limit 1), '00000000-0000-0000-0000-0000000000c5', 'viewer')$$), '2.7 viewer cannot add members');
select throws_ok($$select org_delete((select id from organizations limit 1))$$, null, null, '2.8 viewer cannot delete the workspace');
select is(visible($$select 1 from org_mcp_tokens$$), 0, '2.9 viewer cannot even LIST workspace MCP tokens');
select throws_ok(format($$select org_revoke_token(auth.uid(), %L, %L)$$, _id('ORG'), _id('TOK')), '42501', null, '2.10 viewer cannot call org_revoke_token (not granted to clients)');
select throws_ok(format($$select org_issue_token(auth.uid(), %L, 'mine', repeat('1', 64), 'abcdef')$$, _id('ORG')), '42501', null, '2.11 viewer cannot mint a token directly');
select throws_ok($$select org_mcp_authenticate(repeat('a', 64))$$, '42501', null, '2.12 clients cannot probe token hashes');
select is(visible($$select 1 from organizations$$), 1, '2.13 viewer sees only their own workspace');

-- the same attempts through the trusted (service-role) path: the function itself must re-check the actor's role
select _as_service();
select throws_ok(format($$select org_revoke_token(%L, %L, %L)$$, _id('VIEWER'), _id('ORG'), _id('TOK')), '42501', 'forbidden', '2.14 service path: viewer cannot revoke a token');
select throws_ok(format($$select org_revoke_token(%L, %L, %L)$$, _id('EDITOR'), _id('ORG'), _id('TOK')), '42501', 'forbidden', '2.15 service path: editor cannot revoke a token');
select throws_ok(format($$select org_issue_token(%L, %L, 'x', repeat('2', 64), 'abcdef')$$, _id('VIEWER'), _id('ORG')), null, null, '2.16 service path: viewer cannot mint a token');
select throws_ok(format($$select org_revoke_token(%L, %L, %L)$$, _id('OUT'), _id('ORG'), _id('TOK')), '42501', 'forbidden', '2.17 service path: outsider cannot revoke a token');
select is((select count(*)::int from org_mcp_authenticate(encode(sha256('buk_org_qa_token'::bytea), 'hex'))), 1, '2.18 the token still works after all those failed revocations');
select is((select org_revoke_token(_id('ADMIN'), _id('ORG'), _id('TOK'))), true, '2.19 an admin CAN revoke');
select is((select count(*)::int from org_mcp_authenticate(encode(sha256('buk_org_qa_token'::bytea), 'hex'))), 0, '2.20 and the revoked token stops authenticating immediately');
reset role;

-- a token is only as strong as its creator: demote the admin and the token dies
do $$ begin perform org_issue_token(_id('ADMIN'), _id('ORG'), 'second', encode(sha256('buk_org_qa_token2'::bytea), 'hex'), 'qa0002'); end $$;
select _as(_id('OWNER'));
update org_members set role = 'viewer' where user_id = _id('ADMIN') and org_id = _id('ORG');
select _as_service();
select is((select count(*)::int from org_mcp_authenticate(encode(sha256('buk_org_qa_token2'::bytea), 'hex'))), 0, '2.21 a token stops working when its creator is demoted below admin');
reset role;

select _as(_id('ADMIN'));      -- now only a viewer
select is(visible($$select 1 from org_mcp_tokens$$), 0, '2.22 the demoted admin can no longer list tokens');
select throws_ok($$select token_hash from org_mcp_tokens$$, '42501', null, '2.23 token_hash is never readable by any client role');

select _as(_id('EDITOR'));
select is(affected($$update oneclist_items set title = 'editor edit' where id = '20000000-0000-0000-0000-000000000001'$$), 1, '2.24 control: an editor CAN edit workspace items');
select ok(blocked($$update org_members set role = 'admin' where user_id = auth.uid()$$), '2.25 editor cannot promote themselves to admin');

select _as(_id('OUT'));
select is(visible($$select 1 from oneclist_items where org_id is not null$$), 0, '2.26 an outsider sees no workspace items');
select is(visible($$select 1 from organizations$$) + visible($$select 1 from org_members$$) + visible($$select 1 from org_mcp_tokens$$), 0, '2.27 an outsider sees no workspace, members or tokens');
select throws_ok(format($$insert into oneclist_items (user_id, org_id, url, url_key, title) values (auth.uid(), %L, 'https://o.example/', 'o.example', 'x')$$, _id('ORG')), '42501', null, '2.28 an outsider cannot write into a workspace');
select ok(not is_org_member(_id('ORG'), 'viewer'), '2.29 is_org_member is false for an outsider');

select _as_anon();
select is(visible($$select 1 from organizations$$) + visible($$select 1 from org_members$$) + visible($$select 1 from org_mcp_tokens$$) + visible($$select 1 from oneclist_items where org_id is not null$$), 0, '2.30 anon sees no workspace data at all');
reset role;

-- ================================================================ 3. ANON vs PUBLIC STACKS (the only public surface)
select _as_anon();
select is(visible($$select 1 from oneclist_items$$), 0, '3.1 anon sees zero vault items, public or not');
select ok(blocked($$insert into oneclist_items (user_id, url, url_key, title) values ('00000000-0000-0000-0000-0000000000a1', 'https://anon.example/', 'anon.example', 'anon')$$), '3.2 anon cannot insert items');
select is(visible($$select 1 from stacks$$) + visible($$select 1 from stack_items$$) + visible($$select 1 from creator_profiles$$), 0, '3.3 anon cannot read stack tables directly');
select throws_ok($$select create_stack('t', null, null, 'anon-stack', 'anonhandle', '[]'::jsonb)$$, '42501', null, '3.4 anon cannot create a stack');
select throws_ok($$select fork_stack('whatever')$$, '42501', null, '3.5 anon cannot fork');
reset role;

select _as(_id('A'));
do $$ begin perform create_stack('Postgres toolkit', 'my picks', 'mint', 'pg-toolkit', 'alice_qa', jsonb_build_array(jsonb_build_object('id', '10000000-0000-0000-0000-0000000000a1', 'blurb', 'start here'))); end $$;
select is((select is_public from stacks where slug = 'pg-toolkit'), true, '3.6 documents current behaviour: a new stack is PUBLIC by default (publish-on-create)');
select throws_ok($$select create_stack('Leaky', null, null, 'leaky', 'alice_qa', jsonb_build_array(jsonb_build_object('id', '10000000-0000-0000-0000-0000000000a2')))$$, null, 'no_valid_items', '3.7 an is_private item cannot be put in a stack');

update stacks set is_public = false where slug = 'pg-toolkit';
select _as_anon();
select is(get_public_stack('pg-toolkit'), null::jsonb, '3.8 anon cannot read an unpublished stack');
reset role;
select _as(_id('A'));
update stacks set is_public = true where slug = 'pg-toolkit';
select _as_anon();
select is(get_public_stack('pg-toolkit') ->> 'title', 'Postgres toolkit', '3.9 once published, anon can read the stack via the RPC');
select is(jsonb_array_length(get_public_stack('pg-toolkit') -> 'items'), 1, '3.10 ... with its items');
select is((select array_agg(k order by k) from jsonb_object_keys(get_public_stack('pg-toolkit') -> 'items' -> 0) k), array['blurb', 'title', 'url'], '3.11 item payload is exactly title/url/blurb (no ids, no owner, no private fields)');
select ok(not (get_public_stack('pg-toolkit') ? 'user_id') and not (get_public_stack('pg-toolkit') ? 'id'), '3.12 stack payload exposes no user_id or internal id');
select is(get_public_stack('PG-TOOLKIT') ->> 'slug', 'pg-toolkit', '3.13 slug lookup is case-insensitive');
select is(get_public_stack($$pg-toolkit' or '1'='1$$), null::jsonb, '3.14 a SQL-injection-shaped slug returns nothing');
reset role;

select _as(_id('B'));
select is(fork_stack('pg-toolkit'), 1, '3.15 B can fork the public stack: 1 link copied');
select is((select count(*)::int from oneclist_items where user_id = _id('B') and source = 'stack_fork'), 1, '3.16 the copy lives in B''s vault only');
select is(fork_stack('pg-toolkit'), 0, '3.17 forking twice copies nothing new (idempotent)');
select is(affected($$update stacks set title = 'B owns this now' where slug = 'pg-toolkit'$$), 0, '3.18 B cannot edit A''s stack');
select throws_ok($$select fork_stack('does-not-exist')$$, null, 'not_found', '3.19 forking an unknown or private slug fails with not_found');
reset role;
select is((select count(*)::int from oneclist_items where user_id = _id('A')), 2, '3.20 A''s own vault is unchanged by B''s fork');

update stacks set is_blocked = true where slug = 'pg-toolkit';           -- moderation switch (service/owner only)
select _as_anon();
select is(get_public_stack('pg-toolkit'), null::jsonb, '3.21 a moderator-blocked stack disappears from the public RPC');
reset role;
select _as(_id('B'));
select throws_ok($$select fork_stack('pg-toolkit')$$, null, 'not_found', '3.22 ... and cannot be forked');
reset role;

select * from finish();
rollback;
