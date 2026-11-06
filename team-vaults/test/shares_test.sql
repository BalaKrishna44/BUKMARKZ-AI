\set ON_ERROR_STOP on
set client_min_messages = notice;
create or replace function ok(c boolean, m text) returns void language plpgsql as $$ begin if c is not true then raise exception 'FAIL: %', m; end if; raise notice 'ok   %', m; end $$;
create or replace function fails(q text, frag text) returns boolean language plpgsql as $$ begin execute q; return false; exception when others then return position(frag in sqlerrm || ' ' || sqlstate) > 0; end $$;
\set A '00000000-0000-0000-0000-0000000000a1'
\set B '00000000-0000-0000-0000-0000000000b1'
\set C '00000000-0000-0000-0000-0000000000c1'
\set E '00000000-0000-0000-0000-0000000000e1'
\set G '00000000-0000-0000-0000-0000000000a9'
\set asA 'reset role; select set_config(''request.jwt.claim.sub'', ''00000000-0000-0000-0000-0000000000a1'', false) as _; set role authenticated;'
\set asB 'reset role; select set_config(''request.jwt.claim.sub'', ''00000000-0000-0000-0000-0000000000b1'', false) as _; set role authenticated;'
\set asPG 'reset role; select set_config(''request.jwt.claim.sub'', '''', false) as _;'
\set asANON 'reset role; select set_config(''request.jwt.claim.sub'', '''', false) as _; set role anon;'
\set asSRV 'reset role; select set_config(''request.jwt.claim.sub'', '''', false) as _; set role service_role;'
grant all on all tables in schema public to service_role;   -- Supabase grants this by default; the fixtures do not
insert into auth.users(id, email) values (:'A','sarah@x.test'),(:'B','viewer@x.test'),(:'C','editor@x.test'),(:'E','new@x.test'),(:'G','solo@x.test');

-- workspace: A owner (via create_org), C editor, B viewer; seat_limit 5
:asA
select id as org1 from create_org('Acme', 'acme', 'a@x.test') \gset
:asPG
update organizations set seat_limit = 4 where id = :'org1';
insert into org_members(org_id, user_id, role) values (:'org1', :'C', 'editor'), (:'org1', :'B', 'viewer');
insert into oneclist_items(user_id, url, url_key, title) values
  (:'A', 'https://r.example/1', 'r.example/1', 'Research 1'), (:'A', 'https://r.example/2', 'r.example/2', 'Research 2'),
  (:'A', 'https://r.example/priv', 'r.example/priv', 'Secret'), (:'B', 'https://r.example/b', 'r.example/b', 'B item'), (:'G', 'https://r.example/g', 'r.example/g', 'Solo item');
update oneclist_items set is_private = true where url_key = 'r.example/priv';
select id as i1 from oneclist_items where url_key = 'r.example/1' \gset
select id as i2 from oneclist_items where url_key = 'r.example/2' \gset
select id as ipriv from oneclist_items where url_key = 'r.example/priv' \gset
select id as ib from oneclist_items where url_key = 'r.example/b' \gset
select id as ig from oneclist_items where url_key = 'r.example/g' \gset

-- ===== privileges =====
:asB
select ok(fails($$select team_share_create(auth.uid(), gen_random_uuid(), null, 'x@y.test', repeat('a', 64))$$, '42501'), 'signed-in users cannot call the RPCs');
select ok(fails($$select token_hash from team_shares$$, '42501'), 'token_hash is not readable by clients');
select ok(fails($$insert into team_shares(org_id,item_id,shared_by,invitee_email,token_hash) values (gen_random_uuid(),gen_random_uuid(),auth.uid(),'a@b.co',repeat('a',64))$$, '42501'), 'clients cannot insert shares');
:asANON
select ok(fails($$select team_share_accept(gen_random_uuid(), repeat('a', 64))$$, '42501'), 'anon cannot accept');

-- ===== create =====
:asSRV
select ok((select outcome from team_share_create(:'A', :'i1', null, ' New@X.test ', repeat('1', 64))) = 'created', 'owner tags a colleague: created (single workspace inferred, email normalised)');
select ok((select org_id from oneclist_items where id = :'i1') = :'org1', 'item is linked to the workspace');
select ok((select invitee_email from team_shares) = 'new@x.test' and (select status from team_shares) = 'pending', 'pending share stored lower-cased');
select ok((select outcome from team_share_create(:'A', :'i1', null, 'new@x.test', repeat('2', 64))) = 'duplicate', 're-tag within 10 minutes: duplicate, no new email');
select ok((select token_hash from team_shares) = repeat('1', 64), 'duplicate does not rotate the token');
update team_shares set last_sent_at = now() - interval '11 minutes';
select outcome as o3 from team_share_create(:'A', :'i1', null, 'new@x.test', repeat('3', 64)) \gset
select ok(:'o3' = 'resent' and (select token_hash from team_shares) = repeat('3', 64) and (select send_count from team_shares) = 2, 're-tag later: resent with a rotated token');
select ok((select outcome from team_share_create(:'A', :'i2', :'org1', 'viewer@x.test', repeat('4', 64))) = 'member', 'already a member: no invite, no email');
select ok(fails(format($$select team_share_create(%L, %L, null, 'x@y.test', repeat('5', 64))$$, :'B', :'i1'), 'item_not_found'), 'cannot tag someone else''s item');
select ok(fails(format($$select team_share_create(%L, %L, null, 'x@y.test', repeat('5', 64))$$, :'A', :'ipriv'), 'private_item_cannot_be_shared'), 'private items cannot be shared');
select ok(fails(format($$select team_share_create(%L, %L, null, 'sarah@x.test', repeat('5', 64))$$, :'A', :'i2'), 'invalid_email'), 'cannot invite yourself');
select ok(fails(format($$select team_share_create(%L, %L, null, 'not an email', repeat('5', 64))$$, :'A', :'i2'), 'invalid_email'), 'bad email rejected');
select ok(fails(format($$select team_share_create(%L, %L, null, 'x@y.test', repeat('5', 64))$$, :'B', :'ib'), '42501'), 'viewers cannot tag');
select ok(fails(format($$select team_share_create(%L, %L, null, 'x@y.test', repeat('5', 64))$$, :'G', :'ig'), '42501'), 'a user outside any workspace cannot tag');
select ok(fails(format($$select team_share_create(%L, %L, %L, 'x@y.test', repeat('5', 64))$$, :'G', :'ig', :'org1'), '42501'), 'naming a workspace you are not in is refused');
select ok(fails(format($$select team_share_create(%L, %L, null, 'x@y.test', 'short')$$, :'A', :'i2'), 'check'), 'token hash must be sha256 hex');

-- unsend: a failed email leaves nothing behind
select ok((select outcome from team_share_create(:'A', :'i2', null, 'late@x.test', repeat('6', 64))) = 'created', 'second item shared');
select id as sh2, true as moved from team_shares where item_id = :'i2' \gset
select team_share_unsend(:'B', :'sh2', true, true);
select ok((select count(*) from team_shares where item_id = :'i2') = 1, 'someone else cannot unsend my share');
select team_share_unsend(:'A', :'sh2', true, true);
select ok((select count(*) from team_shares where item_id = :'i2') = 0 and (select org_id from oneclist_items where id = :'i2') is null, 'unsend deletes the share and moves the item back');
select team_share_create(:'A', :'i2', null, 'late@x.test', repeat('6', 64));
select ok((select org_id from oneclist_items where id = :'i1') = :'org1', 'earlier share keeps item i1 in the workspace');

-- seat limit: 3 members (A,C,B) + limit 4 -> one more fits, then full
insert into org_members(org_id, user_id, role) values (:'org1', :'G', 'viewer');
select ok(fails(format($$select team_share_create(%L, %L, null, 'full@x.test', repeat('7', 64))$$, :'A', :'i1'), 'seat_limit_reached'), 'no invites once the seats are full');
delete from org_members where user_id = :'G' and org_id = :'org1';

-- rate limit
insert into team_shares(org_id, item_id, shared_by, invitee_email, token_hash)
  select :'org1', :'i1', :'A', 'bulk' || g || '@x.test', lpad(to_hex(g), 64, '0') from generate_series(1, 30) g;
select ok(fails(format($$select team_share_create(%L, %L, null, 'over@x.test', repeat('8', 64))$$, :'A', :'i1'), 'rate_limited'), '30 invites per user per day');
delete from team_shares where invitee_email like 'bulk%';

-- ===== accept =====
select ok(fails(format($$select team_share_accept(%L, repeat('9', 64))$$, :'E'), 'invalid_invite'), 'unknown token is invalid');
select ok(fails(format($$select team_share_accept(%L, repeat('3', 64))$$, :'C'), 'wrong_account'), 'token used by a different account is refused');
select ok((select count(*) from team_shares where status = 'pending') = 2, 'wrong account did not consume the invite');
select ok((select org_slug from team_share_accept(:'E', repeat('3', 64))) = 'acme', 'invitee accepts');
select ok((select role from org_members where user_id = :'E' and org_id = :'org1') = 'viewer', 'joins as viewer only');
select ok(fails(format($$select team_share_accept(%L, repeat('3', 64))$$, :'E'), 'invalid_invite'), 'token is single use');
update team_shares set expires_at = now() - interval '1 minute' where token_hash = lpad('', 0) or invitee_email = 'late@x.test';
select ok(fails(format($$select team_share_accept(%L, repeat('6', 64))$$, :'E'), 'invalid_invite'), 'expired token is invalid');

-- accepted invitee can read the shared item through the 017 policies
:asPG
select set_config('request.jwt.claim.sub', :'E', false);
set role authenticated;
select ok((select count(*) from oneclist_items where id = :'i1') = 1, 'accepted invitee can read the shared item');
select ok((select count(*) from oneclist_items where id = :'ib') = 0, 'and nothing else of the colleague''s vault');
