\set ON_ERROR_STOP on
create or replace function ok(c boolean, m text) returns void language plpgsql as $$ begin if not c then raise exception 'FAIL: %', m; end if; raise notice 'ok   %', m; end $$;
-- run a statement as a user; returns the error message or 'OK'
create or replace function as_user(u text, q text) returns text language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(u,''), false); execute 'set local role ' || case when u is null then 'anon' else 'authenticated' end;
  begin execute q; reset role; return 'OK'; exception when others then reset role; return sqlerrm; end; end $$;
set client_min_messages = notice;
\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set C '00000000-0000-0000-0000-00000000000c'
insert into auth.users values (:'A'),(:'B'),(:'C');
grant execute on function ok(boolean,text), as_user(text,text) to public;

-- A creates a stack through the real create_stack (as A)
insert into oneclist_items(user_id,url,url_key,title) select :'A', 'https://e'||i||'.com/x', 'e'||i||'.com/x', 'Item '||i from generate_series(1,4) i;
begin;
  select set_config('request.jwt.claim.sub', :'A', true); set local role authenticated;
  select create_stack('Best Rust Reads', 'Hand-picked', 'ocean', 'best-rust-reads', 'ada_codes', (select jsonb_agg(jsonb_build_object('id', id, 'blurb', 'b'||title)) from (select id, title from oneclist_items where user_id = :'A'::uuid order by title) q)) as r \gset
commit;
select ok(:'r'::jsonb->>'count' = '4', 'A published a 4-link stack');
select ok((get_public_stack('best-rust-reads')->>'follower_count')::int = 0 and get_public_stack('best-rust-reads')->'remixed_from' = 'null'::jsonb, 'public read: zero followers, no remix credit');

-- ---- follow
begin; select set_config('request.jwt.claim.sub', :'B', true); set local role authenticated;
  select ok((follow_stack('best-rust-reads')->>'follower_count')::int = 1, 'B follows -> count 1');
  select ok((follow_stack('best-rust-reads')->>'follower_count')::int = 1 and (follow_stack('best-rust-reads')->>'new')::boolean = false, 'following twice is idempotent (still 1)');
  select ok((stack_viewer_state('best-rust-reads')->>'following')::boolean and not (stack_viewer_state('best-rust-reads')->>'own')::boolean, 'viewer state: following, not own');
commit;
select ok(as_user(:'A', $q$select follow_stack('best-rust-reads')$q$) = 'own_stack', 'cannot follow your own stack');
select ok(as_user(null, $q$select follow_stack('best-rust-reads')$q$) like 'permission denied%', 'anon cannot call follow_stack');
select ok(as_user(:'B', $q$select follow_stack('nope-nope')$q$) = 'not_found', 'unknown stack -> not_found');
select ok(as_user(null, $q$do $d$ begin if (stack_viewer_state('best-rust-reads')->>'authed')::boolean then raise exception 'wrongly authed'; end if; end $d$$q$) = 'OK', 'anon viewer state: authed=false, readable by anon');
select ok(as_user(:'B', $q$insert into stack_follows(user_id, stack_id) select auth.uid(), id from stacks limit 1$q$) like 'permission denied%', 'no direct writes to stack_follows');
select ok(as_user(:'B', $q$update stacks set follower_count = 9999 where slug = 'best-rust-reads'$q$) like 'permission denied%' or (select follower_count from stacks where slug='best-rust-reads') = 1, 'follower_count not writable by users');
begin; select set_config('request.jwt.claim.sub', :'B', true); set local role authenticated;
  select ok((unfollow_stack('best-rust-reads')->>'follower_count')::int = 0, 'unfollow -> count 0');
  select ok((unfollow_stack('best-rust-reads')->>'follower_count')::int = 0, 'unfollow twice does not go negative');
commit;

-- ---- hardening: owners can no longer insert counters directly
select ok(as_user(:'A', $q$insert into stacks(user_id, slug, title, fork_count) values (auth.uid(), 'cheat-stack', 'Cheat stack', 999)$q$) like 'permission denied%', 'direct INSERT with fork_count is denied (010 hole closed)');
select ok(as_user(:'A', $q$insert into stacks(user_id, slug, title, remix_count) values (auth.uid(), 'cheat-stack2', 'Cheat stack', 999)$q$) like 'permission denied%', 'direct INSERT with remix_count is denied');
select ok(as_user(:'A', $q$insert into stacks(user_id, slug, title) values (auth.uid(), 'plain-insert', 'Plain insert')$q$) = 'OK', 'plain INSERT of allowed columns still works');
delete from stacks where slug = 'plain-insert';

-- ---- remix
select ok(as_user(:'A', $q$select remix_stack('best-rust-reads', 'my-copy', null)$q$) = 'own_stack', 'cannot remix your own stack');
select ok(as_user(:'B', $q$select remix_stack('best-rust-reads', 'rusty-copy', null)$q$) = 'handle_required', 'first-time remixer must choose a handle');
select ok(as_user(:'B', $q$select remix_stack('best-rust-reads', 'rusty-copy', 'ada_codes')$q$) = 'handle_taken', 'handle already taken');
select ok((select count(*) from stacks where slug = 'rusty-copy') = 0, 'failed remix left nothing behind');
begin; select set_config('request.jwt.claim.sub', :'B', true); set local role authenticated;
  select remix_stack('best-rust-reads', 'rusty-copy', 'bob_builds') as r2 \gset
commit;
select ok(:'r2'::jsonb->>'count' = '4' and :'r2'::jsonb->>'slug' = 'rusty-copy', 'B remixed: 4 links copied into a new stack');
select ok((select count(*) from stack_items i join stacks s on s.id = i.stack_id where s.slug = 'rusty-copy' and i.blurb like 'bItem%') = 4, 'links and blurbs are copied');
select ok((select user_id from stacks where slug = 'rusty-copy') = :'B'::uuid, 'the remix belongs to B');
select ok(get_public_stack('rusty-copy')->'remixed_from'->>'handle' = 'ada_codes' and get_public_stack('rusty-copy')->>'handle' = 'bob_builds', 'credit line data: remixed_from @ada_codes');
select ok((get_public_stack('best-rust-reads')->>'remix_count')::int = 1, 'original remix_count = 1');
begin; select set_config('request.jwt.claim.sub', :'B', true); set local role authenticated;
  select remix_stack('best-rust-reads', 'rusty-copy-2', null) as r3 \gset
commit;
select ok((get_public_stack('best-rust-reads')->>'remix_count')::int = 1, 'a second remix by the same user does not inflate remix_count');
begin; select set_config('request.jwt.claim.sub', :'C', true); set local role authenticated;
  select remix_stack('rusty-copy', 'rusty-copy-c', 'cara_c') as r4 \gset
commit;
select ok(get_public_stack('rusty-copy-c')->'remixed_from'->>'handle' = 'bob_builds' and (get_public_stack('rusty-copy')->>'remix_count')::int = 1, 'remix of a remix credits the direct parent');
select ok(as_user(:'C', $q$select remix_stack('rusty-copy', 'rusty-copy', null)$q$) = 'slug_taken', 'taken slug -> slug_taken (API retries with a new suffix)');
select ok(as_user(:'C', $q$select * from stack_remixes$q$) = 'OK' and (select count(*) from stack_remixes) = 3, '3 lineage rows recorded');
select ok(as_user(null, $q$select remix_stack('best-rust-reads', 'anon-copy', null)$q$) like 'permission denied%', 'anon cannot remix');

-- ---- visibility: credit must not leak a hidden original
update stacks set is_public = false where slug = 'best-rust-reads';
select ok(get_public_stack('rusty-copy')->'remixed_from' = 'null'::jsonb and get_public_stack('best-rust-reads') is null, 'original made private: credit disappears, original unreadable');
select ok(as_user(:'C', $q$select remix_stack('best-rust-reads', 'late-copy', null)$q$) = 'not_found', 'cannot remix a private stack');
select ok(as_user(:'B', $q$select follow_stack('best-rust-reads')$q$) = 'not_found', 'cannot follow a private stack');
update stacks set is_public = true, is_blocked = true where slug = 'best-rust-reads';
select ok(as_user(:'C', $q$select remix_stack('best-rust-reads', 'late-copy', null)$q$) = 'not_found', 'cannot remix a blocked stack');
update stacks set is_blocked = false where slug = 'best-rust-reads';

-- ---- limits + cascades
update stacks set created_at = now() - interval '2 days';
do $$ declare i int; begin for i in 1..20 loop insert into stacks(user_id, slug, title, created_at) values ('00000000-0000-0000-0000-00000000000c', 'filler-'||i, 'Filler '||i, now() - interval '2 days'); end loop; end $$;
select as_user(:'C', $q$select remix_stack('best-rust-reads', 'over-limit', null)$q$) as dbg \gset
select ok(:'dbg' = 'OK', 'older stacks do not trip the daily limit: '||:'dbg');
do $$ declare i int; begin for i in 1..20 loop insert into stacks(user_id, slug, title, created_at) values ('00000000-0000-0000-0000-00000000000c', 'fresh-'||i, 'Fresh '||i, now()); end loop; end $$;
select ok(as_user(:'C', $q$select remix_stack('best-rust-reads', 'over-limit-2', null)$q$) = 'rate_limited', 'daily stack limit applies to remixes');
delete from stacks where slug = 'best-rust-reads';
select ok((select original_stack_id from stack_remixes where remixed_stack_id = (select id from stacks where slug = 'rusty-copy')) is null and exists (select 1 from stacks where slug = 'rusty-copy'), 'original deleted: remix survives, lineage nulled');
select ok(get_public_stack('rusty-copy')->'remixed_from' = 'null'::jsonb, 'no credit once the original is gone');
select 'ALL PASSED' as result;
