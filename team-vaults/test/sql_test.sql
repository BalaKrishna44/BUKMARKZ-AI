\set ON_ERROR_STOP on
set client_min_messages = notice;
create or replace function ok(c boolean, m text) returns void language plpgsql as $$ begin if c is not true then raise exception 'FAIL: %', m; end if; raise notice 'ok   %', m; end $$;
-- run a statement as the CURRENT role; true if it raised and the message/sqlstate contains `frag`
create or replace function fails(q text, frag text) returns boolean language plpgsql as $$ begin execute q; return false; exception when others then return position(frag in sqlerrm || ' ' || sqlstate) > 0; end $$;
create or replace function affected(q text) returns int language plpgsql as $$ declare n int; begin execute q; get diagnostics n = row_count; return n; end $$;
\set A '00000000-0000-0000-0000-0000000000a1'
\set B '00000000-0000-0000-0000-0000000000b1'
\set C '00000000-0000-0000-0000-0000000000c1'
\set D '00000000-0000-0000-0000-0000000000d1'
\set E '00000000-0000-0000-0000-0000000000e1'
\set F '00000000-0000-0000-0000-0000000000f1'
\set asA 'reset role; select set_config(''request.jwt.claim.sub'', ''00000000-0000-0000-0000-0000000000a1'', false) as _; set role authenticated;'
\set asB 'reset role; select set_config(''request.jwt.claim.sub'', ''00000000-0000-0000-0000-0000000000b1'', false) as _; set role authenticated;'
\set asC 'reset role; select set_config(''request.jwt.claim.sub'', ''00000000-0000-0000-0000-0000000000c1'', false) as _; set role authenticated;'
\set asD 'reset role; select set_config(''request.jwt.claim.sub'', ''00000000-0000-0000-0000-0000000000d1'', false) as _; set role authenticated;'
\set asE 'reset role; select set_config(''request.jwt.claim.sub'', ''00000000-0000-0000-0000-0000000000e1'', false) as _; set role authenticated;'
\set asF 'reset role; select set_config(''request.jwt.claim.sub'', ''00000000-0000-0000-0000-0000000000f1'', false) as _; set role authenticated;'
\set asPG 'reset role; select set_config(''request.jwt.claim.sub'', '''', false) as _;'
\set asANON 'reset role; select set_config(''request.jwt.claim.sub'', '''', false) as _; set role anon;'
\set asSRV 'reset role; select set_config(''request.jwt.claim.sub'', '''', false) as _; set role service_role;'
insert into auth.users(id, email) values (:'A','a@x.test'),(:'B','b@x.test'),(:'C','c@x.test'),(:'D','d@x.test'),(:'E','e@x.test'),(:'F','f@x.test');

-- ===== create_org + roles =====
:asA
select id as org1 from create_org('  Acme Inc ', 'ACME', 'billing@acme.test') \gset
select ok((select role from org_members where org_id = :'org1' and user_id = :'A') = 'owner' and (select slug from organizations where id = :'org1') = 'acme', 'create_org: creator becomes owner, slug normalised');
select ok(fails($$select create_org('X', 'bad slug', 'a@b.co')$$, 'violates check'), 'create_org: invalid slug rejected');
select create_org('Two', 'acme-two', 'a@b.co') is not null as _;
select create_org('Three', 'acme-three', 'a@b.co') is not null as _;
select ok(fails($$select create_org('Four', 'acme-four', 'a@b.co')$$, 'org_limit_reached'), 'create_org: max 3 workspaces per creator');
select ok(fails($$insert into organizations(name, slug, billing_email, created_by) values ('Evil','evil-co','e@e.co', auth.uid())$$, 'permission denied'), 'organizations: no direct insert from clients');
select org_delete(id) from organizations where slug in ('acme-two','acme-three');
select ok((select count(*) from organizations) = 1, 'org_delete: owner can remove an empty workspace');
:asANON
select ok(fails($$select create_org('Anon','anon-co','a@b.co')$$, 'permission denied'), 'anonymous cannot create a workspace');
:asA
select org_add_member_by_email(:'org1', 'B@x.test', 'admin') as _;
select org_add_member_by_email(:'org1', 'c@x.test', 'editor') as _;
select org_add_member_by_email(:'org1', 'd@x.test', 'viewer') as _;
select ok((select count(*) from org_members where org_id = :'org1') = 4, 'owner added admin, editor, viewer (email lookup is case-insensitive)');
:asE
select ok(not is_org_member(:'org1', 'viewer'), 'outsider is not a member');
select ok(fails($$select is_org_member(null, 'god')$$, 'invalid_role'), 'unknown role name raises');
:asANON
select ok(fails(format($$select is_org_member(%L, 'viewer')$$, :'org1'), 'permission denied'), 'anonymous role cannot even call the membership check');
:asA
select ok(is_org_member(:'org1', 'owner') and is_org_member(:'org1', 'viewer'), 'owner satisfies every level');
:asB
select ok(is_org_member(:'org1', 'admin') and not is_org_member(:'org1', 'owner'), 'admin: admin yes, owner no');
:asC
select ok(is_org_member(:'org1', 'editor') and not is_org_member(:'org1', 'admin'), 'editor: editor yes, admin no');
:asD
select ok(is_org_member(:'org1', 'viewer') and not is_org_member(:'org1', 'editor'), 'viewer: viewer yes, editor no');

-- ===== client-side role manipulation =====
:asD
select ok(affected(format($$update org_members set role = 'owner' where org_id = %L and user_id = %L$$, :'org1', :'D')) = 0, 'viewer cannot promote self (RLS hides the write)');
select ok(fails(format($$insert into org_members(org_id, user_id, role) values (%L, %L, 'owner')$$, :'org1', :'E'), '42501'), 'viewer cannot add members');
:asC
select ok(affected(format($$update org_members set role = 'admin' where org_id = %L and user_id = %L$$, :'org1', :'C')) = 0, 'editor cannot promote self');
:asE
select ok(fails(format($$insert into org_members(org_id, user_id, role) values (%L, %L, 'owner')$$, :'org1', :'E'), '42501'), 'outsider cannot join a workspace by inserting a row');
select ok(affected(format($$select * from org_members where org_id = %L$$, :'org1')) = 0, 'outsider cannot list members');
:asB
select ok(fails(format($$update org_members set role = 'admin' where org_id = %L and user_id = %L$$, :'org1', :'D'), 'forbidden'), 'admin cannot create another admin');
select ok(fails(format($$update org_members set role = 'owner' where org_id = %L and user_id = %L$$, :'org1', :'B'), 'cannot_change_own_role'), 'admin cannot promote self');
select ok(fails(format($$update org_members set role = 'viewer' where org_id = %L and user_id = %L$$, :'org1', :'A'), 'forbidden'), 'admin cannot demote the owner');
select ok(fails(format($$delete from org_members where org_id = %L and user_id = %L$$, :'org1', :'A'), 'forbidden'), 'admin cannot remove the owner');
select ok(fails(format($$insert into org_members(org_id, user_id, role) values (%L, %L, 'admin')$$, :'org1', :'E'), 'forbidden'), 'admin cannot add an admin directly');
select ok(fails(format($$update org_members set user_id = %L where org_id = %L and user_id = %L$$, :'E', :'org1', :'D'), 'permission denied'), 'user_id is not client-writable (column grants)');
select ok(fails(format($$update organizations set seat_limit = 500 where id = %L$$, :'org1'), 'permission denied'), 'seat_limit is not client-writable');
select ok(affected(format($$update org_members set role = 'editor' where org_id = %L and user_id = %L$$, :'org1', :'D')) = 1, 'admin can promote viewer to editor');
select ok(affected(format($$update org_members set role = 'viewer' where org_id = %L and user_id = %L$$, :'org1', :'D')) = 1, 'admin can demote editor to viewer');
select ok(affected(format($$update organizations set name = 'Acme Corp' where id = %L$$, :'org1')) = 1, 'admin can rename the workspace');
:asC
select ok(affected(format($$update organizations set name = 'Hacked' where id = %L$$, :'org1')) = 0, 'editor cannot rename the workspace');
:asA
select ok(fails(format($$update org_members set role = 'viewer' where org_id = %L and user_id = %L$$, :'org1', :'A'), 'cannot_change_own_role'), 'owner cannot demote self');
select ok(fails(format($$delete from org_members where org_id = %L and user_id = %L$$, :'org1', :'A'), 'last_owner'), 'last owner cannot leave');
select ok(affected(format($$update org_members set role = 'owner' where org_id = %L and user_id = %L$$, :'org1', :'B')) = 1, 'owner can make a second owner');
select ok(affected(format($$update org_members set role = 'admin' where org_id = %L and user_id = %L$$, :'org1', :'B')) = 1, 'owner can change it back');
select ok((select count(*) from org_list_members(:'org1') where email is not null) = 4, 'admins and owners see member emails');
:asD
select ok((select count(*) from org_list_members(:'org1')) = 4 and (select count(*) from org_list_members(:'org1') where email is not null) = 1, 'viewers see members but only their own email');
:asE
select ok(fails(format($$select * from org_list_members(%L)$$, :'org1'), 'forbidden'), 'outsider cannot list members via RPC');

-- seats
:asA
select org_add_member_by_email(:'org1', 'e@x.test', 'viewer') as _;
:asPG
update organizations set seat_limit = 5;
:asA
select ok(fails(format($$select org_add_member_by_email(%L, 'f@x.test', 'viewer')$$, :'org1'), 'seat_limit_reached'), 'seat limit enforced (5 seats, 5 used)');
select affected(format($$delete from org_members where org_id = %L and user_id = %L$$, :'org1', :'E')) as _;

-- ===== items =====
:asPG
insert into oneclist_items(user_id, url, url_key, title, summary, embedding, embedding_model) values
  (:'C', 'https://p.example/personal', 'p.example/personal', 'C personal secret', 'personal', '{1,0,0}', 'm');
:asC
select ok(affected($$insert into oneclist_items(user_id, url, url_key, title, summary, embedding, embedding_model, org_id) select auth.uid(), 'https://t.example/pg', 't.example/pg', 'Postgres pooling guide', 'connection pooling with pgbouncer', '{0,1,0}', 'm', o.id from organizations o$$) = 1, 'editor can add a shared item');
:asD
select ok(fails($$insert into oneclist_items(user_id, url, url_key, title, org_id) select auth.uid(), 'https://t.example/v', 't.example/v', 'viewer write', o.id from organizations o$$, '42501'), 'viewer cannot add a shared item');
select ok((select count(*) from oneclist_items) = 1 and (select title from oneclist_items) = 'Postgres pooling guide', 'viewer reads shared items, and does not see another member''s personal items');
select ok(affected($$update oneclist_items set title = 'pwned' where org_id is not null$$) = 0, 'viewer cannot edit shared items');
select ok(affected($$delete from oneclist_items where org_id is not null$$) = 0, 'viewer cannot delete shared items');
:asE
select ok((select count(*) from oneclist_items) = 0, 'outsider sees nothing of the workspace');
:asC
select ok((select count(*) from oneclist_items) = 2, 'editor sees shared + own personal items');
select ok(fails($$insert into oneclist_items(user_id, url, url_key, title, org_id) select auth.uid(), 'https://t.example/dup', 't.example/pg', 'dup', o.id from organizations o$$, 'duplicate key'), 'same URL cannot be added twice to a workspace');
select ok(fails($$insert into oneclist_items(user_id, url, url_key, title, org_id) select '00000000-0000-0000-0000-0000000000a1', 'https://t.example/x', 't.example/x', 'forged author', o.id from organizations o$$, '42501'), 'cannot forge another user as the author');
select ok(fails($$update oneclist_items set org_id = null where org_id is not null$$, 'forbidden'), 'editor cannot move shared data into their personal vault');
select ok(fails($$update oneclist_items set user_id = '00000000-0000-0000-0000-0000000000a1' where org_id is not null$$, 'owner_immutable'), 'author of a shared item cannot be changed by clients');
select ok(fails($$update oneclist_items set is_private = true where org_id is not null$$, 'private_item_cannot_be_shared'), 'shared items cannot be private');
select ok(affected($$update oneclist_items set org_id = (select id from organizations), url_key = url_key where url = 'https://p.example/personal'$$) = 1, 'author can share a personal item (move)');
select ok((select count(*) from oneclist_items where org_id is null) = 0, 'moved item is no longer personal');
select ok(affected($$update oneclist_items set title = 'Edited by editor' where org_id is not null$$) = 2, 'editors can edit any shared item');
:asB
select ok(fails($$update oneclist_items set org_id = null where url = 'https://p.example/personal'$$, 'forbidden'), 'admin who is not the author cannot pull an item out');
:asC
select ok(affected($$delete from oneclist_items where url = 'https://p.example/personal'$$) = 1, 'editor can delete their own shared item');
:asB
select ok(affected($$delete from oneclist_items where org_id is not null$$) = 1, 'admin can delete anyone''s shared item');
:asC
-- personal path unchanged for a user with no org
:asF
select affected($$insert into oneclist_items(user_id, url, url_key, title) values (auth.uid(), 'https://f.example', 'f.example', 'F item')$$) as n \gset
select ok(:n = 1 and (select count(*) from oneclist_items) = 1, 'users outside any workspace work exactly as before');
select ok(fails(format($$insert into oneclist_items(user_id, url, url_key, title, org_id) values (auth.uid(), 'https://f.example/2', 'f.example/2', 'x', %L)$$, :'org1'), '42501'), 'non-member cannot write into a workspace');

-- ===== leaving / removal keeps team data =====
:asPG
insert into oneclist_items(user_id, url, url_key, title, org_id) values (:'C', 'https://t.example/c1', 't.example/c1', 'C shared 1', :'org1'), (:'C', 'https://t.example/c2', 't.example/c2', 'C shared 2', :'org1');
insert into oneclist_items(user_id, url, url_key, title) values (:'A', 'https://t.example/c2', 't.example/c2', 'A personal with same url');
select org_issue_token(:'B', :'org1', 'for C test', repeat('1', 64), 'abcdef') as tok_b \gset
insert into org_members(org_id, user_id, role) values (:'org1', :'F', 'viewer');
:asB
select ok(affected(format($$delete from org_members where org_id = %L and user_id = %L$$, :'org1', :'F')) = 1, 'admin removes a viewer');
:asB
select ok(affected(format($$delete from org_members where org_id = %L and user_id = %L$$, :'org1', :'C')) = 1, 'admin removes an editor');
:asPG
select ok((select count(*) from oneclist_items where org_id = :'org1' and user_id = :'C') = 0 and (select count(*) from oneclist_items where org_id = :'org1') = 2, 'removed member''s shared items stay with the workspace (reassigned to an owner)');
select ok((select count(distinct user_id) from oneclist_items where org_id = :'org1') = 1 and (select user_id from oneclist_items where org_id = :'org1' limit 1) in (:'A', :'B'), 'items now belong to an owner');
select ok((select count(*) from oneclist_items where org_id = :'org1' and url_key like '%#org-%') = 1, 'URL clash with the heir''s personal item is resolved by suffixing, not by failing');
:asC
select ok((select count(*) from oneclist_items where org_id is not null) = 0, 'removed member can no longer read anything shared');
:asPG

-- ===== stacks =====
insert into org_members(org_id, user_id, role) values (:'org1', :'C', 'editor'), (:'org1', :'F', 'viewer');
insert into oneclist_items(id, user_id, url, url_key, title) values ('00000000-0000-0000-0000-00000000aaa1', :'C', 'https://one.example', 'one.example', 'One');
insert into oneclist_items(id, user_id, url, url_key, title, org_id) values ('00000000-0000-0000-0000-00000000aaa2', :'C', 'https://team-secret.example', 'team-secret.example', 'Team secret', :'org1');
:asC
select create_stack('Team reading', 'desc', 'mint', 'team-reading', 'cee', '[{"id":"00000000-0000-0000-0000-00000000aaa1"},{"id":"00000000-0000-0000-0000-00000000aaa2"}]'::jsonb) as made \gset
select ok((:'made'::jsonb->>'count')::int = 1 and (select count(*) from stacks) = 1, 'create_stack works as before for personal items, and skips items that belong to a workspace');
select move_stack_to_org((select id from stacks limit 1), :'org1') as _;
select ok((select org_id from stacks limit 1) = :'org1' and not (select is_public from stacks limit 1), 'moving a stack to a workspace makes it private');
select ok(fails($$update stacks set is_public = true$$, 'only admins'), 'editor cannot publish a team stack');
:asF
select ok((select count(*) from stacks) = 1 and (select count(*) from stack_items) = 1, 'viewer reads team stack and its items');
select ok(affected($$update stacks set title = 'Renamed'$$) = 0 and affected($$delete from stack_items$$) = 0, 'viewer cannot edit team stack or items');
:asE
select ok((select count(*) from stacks) = 0 and (select count(*) from stack_items) = 0, 'outsider cannot see team stack');
:asB
select ok(affected($$update stacks set is_public = true$$) = 1, 'admin can publish a team stack');
:asC
select ok(affected($$update stacks set title = 'By author editor'$$) = 1, 'editor can edit team stack');
:asPG
update org_members set role = 'viewer' where user_id = :'C' and org_id = :'org1';      -- demote the stack's author
:asC
select ok(affected($$update stacks set title = 'Demoted but author'$$) = 0 and affected($$update stack_items set title = 'x'$$) = 0, 'demoted author loses write access to their team stack and its items');

-- ===== workspace MCP tokens =====
:asPG
update org_members set role = 'editor' where user_id = :'C' and org_id = :'org1';
select ok(fails(format($$select org_issue_token(%L, %L, 'x', repeat('2', 64), 'abcdef')$$, :'C', :'org1'), 'forbidden'), 'an editor cannot create a workspace token');
select org_issue_token(:'B', :'org1', 'Cursor', encode(sha256('buk_org_tok1'::bytea), 'hex'), 'abcdef') as tokid \gset
select ok((select org_id from org_mcp_authenticate(encode(sha256('buk_org_tok1'::bytea), 'hex'))) = :'org1' and (select scopes from org_mcp_authenticate(encode(sha256('buk_org_tok1'::bytea), 'hex'))) = '{read}', 'token authenticates to its workspace with read scope');
select ok(fails(format($$select org_issue_token(%L, %L, 'w', repeat('3', 64), 'abcdef', '{write}')$$, :'B', :'org1'), 'violates check'), 'write scope is not available yet');
select ok((select count(*) from org_mcp_authenticate(repeat('f', 64))) = 0, 'unknown token -> nothing');
update org_mcp_tokens set expires_at = now() - interval '1 second' where id = :'tokid';
select ok((select count(*) from org_mcp_authenticate(encode(sha256('buk_org_tok1'::bytea), 'hex'))) = 0, 'expired token rejected');
update org_mcp_tokens set expires_at = null where id = :'tokid';
update org_members set role = 'editor' where user_id = :'B' and org_id = :'org1';
select ok((select count(*) from org_mcp_authenticate(encode(sha256('buk_org_tok1'::bytea), 'hex'))) = 0 and (select revoked_at is not null from org_mcp_tokens where id = :'tokid'), 'demoting the creator kills their workspace tokens');
update org_members set role = 'admin' where user_id = :'B' and org_id = :'org1';
select org_issue_token(:'B', :'org1', 'second', encode(sha256('buk_org_tok2'::bytea), 'hex'), 'abcdef') as tok2 \gset
select ok(org_revoke_token(:'B', :'org1', :'tok2') and (select count(*) from org_mcp_authenticate(encode(sha256('buk_org_tok2'::bytea), 'hex'))) = 0, 'revoked token stops working');
select ok(fails(format($$select org_revoke_token(%L, %L, %L)$$, :'C', :'org1', :'tokid'), 'forbidden'), 'an editor cannot revoke tokens');
do $$ declare i int; begin for i in 1..10 loop perform org_issue_token('00000000-0000-0000-0000-0000000000b1', (select id from organizations limit 1), 'n'||i, encode(sha256(('bulk'||i)::bytea), 'hex'), 'abcdef'); end loop; end $$;
select ok(fails(format($$select org_issue_token(%L, %L, 'x', repeat('9', 64), 'abcdef')$$, :'B', :'org1'), 'too_many_tokens'), 'at most 10 live tokens per workspace');
:asB
select ok((select count(*) from org_mcp_tokens) >= 10, 'admins can list tokens');
select ok(fails($$select token_hash from org_mcp_tokens$$, 'permission denied'), 'token hashes are never readable by clients');
select ok(fails($$insert into org_mcp_tokens(org_id, name, prefix, token_hash) select id, 'x', 'abcdef', repeat('7', 64) from organizations$$, 'permission denied'), 'clients cannot mint tokens directly');
:asC
select ok((select count(*) from org_mcp_tokens) = 0, 'editors cannot see tokens');
select ok(fails(format($$select org_mcp_authenticate(repeat('a', 64))$$), 'permission denied') and fails($$select org_issue_token(auth.uid(), (select id from organizations limit 1), 'x', repeat('8', 64), 'abcdef')$$, 'permission denied'), 'token RPCs are not callable by clients');
:asPG
-- metering
select org_mcp_meter(:'org1', :'tokid', 3, 100) as _;
do $$ declare r jsonb; org uuid := (select id from organizations limit 1); tok uuid := (select id from org_mcp_tokens limit 1); begin
  perform org_mcp_meter(org, tok, 3, 100); r := org_mcp_meter(org, tok, 3, 100);
  if not (r->>'allowed')::boolean then raise exception 'FAIL: 3rd call denied'; end if;
  r := org_mcp_meter(org, tok, 3, 100);
  if (r->>'allowed')::boolean or r->>'reason' <> 'monthly' then raise exception 'FAIL: cap %', r; end if;
  perform org_mcp_unmeter(org);
  if not (org_mcp_meter(org, tok, 3, 100)->>'allowed')::boolean then raise exception 'FAIL: unmeter'; end if;
  r := org_mcp_meter(org, tok, null, 2);
  if (r->>'allowed')::boolean or r->>'reason' <> 'burst' then raise exception 'FAIL: burst %', r; end if;
  raise notice 'ok   org metering: monthly cap, refund, burst limit';
end $$;

-- ===== org search isolation =====
insert into organizations(name, slug, billing_email, created_by) values ('Other Co', 'other-co', 'o@o.test', :'F') returning id as org2 \gset
insert into org_members(org_id, user_id, role) values (:'org2', :'F', 'owner');
insert into oneclist_items(user_id, url, url_key, title, summary, embedding, embedding_model, org_id, ai_status, is_private) values
  (:'A', 'https://a1.example', 'a1.example', 'Acme postgres tuning', 'indexes and vacuum', '{1,0,0}', 'm', :'org1', 'done', false),
  (:'A', 'https://a2.example', 'a2.example', 'Acme kubernetes notes', 'pods', '{0,1,0}', 'm', :'org1', 'done', false),
  (:'A', 'https://a3.example', 'a3.example', 'Acme skipped postgres', 'x', '{1,0,0}', 'm', :'org1', 'skipped_private', false),
  (:'F', 'https://f1.example', 'f1.example', 'Other Co postgres secrets', 'confidential', '{1,0,0}', 'm', :'org2', 'done', false),
  (:'A', 'https://ap.example', 'ap.example', 'A personal postgres diary', 'mine', '{1,0,0}', 'm', null, 'done', false);
select ok((select count(*) from match_org_items(:'org1', '{1,0,0}'::vector, 0.2, 10, 'postgres', 'm')) = 1 and (select title from match_org_items(:'org1', '{1,0,0}'::vector, 0.2, 10, 'postgres', 'm')) = 'Acme postgres tuning', 'org search: only this workspace; no other workspace, no personal items, no skipped_private');
select ok((select bool_and(org_id = :'org2') from match_org_items(:'org2', '{1,0,0}'::vector, 0.2, 10, 'postgres', 'm')), 'the other workspace gets only its own');
select ok((select count(*) from match_org_items(:'org1', null, 0.2, 10, 'kubernetes')) = 1, 'keyword-only search works without an embedding');
select ok((select title from match_org_items(:'org1', '{0,1,0}'::vector, 0.2, 10, null)) = 'Acme kubernetes notes', 'semantic-only search ranks by similarity and respects the threshold');
select ok((select count(*) from match_org_items('00000000-0000-0000-0000-000000000777', '{1,0,0}'::vector, 0, 10, 'postgres')) = 0, 'unknown workspace -> no rows');
:asC
select ok(fails(format($$select * from match_org_items(%L, null, 0.2, 10, 'postgres')$$, :'org1'), 'permission denied'), 'clients cannot call the search function directly');
:asPG

-- ===== account deletion =====
delete from auth.users where id = :'A';
select ok((select count(*) from org_members where org_id = :'org1' and role = 'owner') = 1 and exists (select 1 from organizations where id = :'org1'), 'owner deleting their account: an heir is promoted, the workspace survives');
select ok((select count(*) from oneclist_items where org_id = :'org1') >= 2 and not exists (select 1 from oneclist_items where user_id = :'A'), 'their shared items were reassigned, not deleted');
delete from auth.users where id = :'F';
select ok(not exists (select 1 from organizations where id = :'org2') and not exists (select 1 from oneclist_items where org_id = :'org2'), 'sole member deleting their account dissolves the workspace');
:asB
select ok(affected(format($$select * from org_members where org_id = %L$$, :'org1')) >= 1, 'heir keeps working after the succession');
:asC
select ok(fails(format($$select org_delete(%L)$$, :'org1'), 'forbidden'), 'only an owner can delete a workspace');
:asPG
