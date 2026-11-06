\set ON_ERROR_STOP on
create or replace function ok(c boolean, m text) returns void language plpgsql as $$ begin if not c then raise exception 'FAIL: %', m; end if; raise notice 'ok   %', m; end $$;
set client_min_messages = notice;
\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
insert into auth.users values (:'A'),(:'B');
-- tokens
select mcp_issue_token(:'A', 'Cursor', repeat('a',64), 'abcdef') as t1 \gset
select ok((select tier from mcp_authenticate(repeat('a',64))) = 'free' and (select user_id from mcp_authenticate(repeat('a',64))) = :'A'::uuid, 'valid token -> its user, free tier by default');
select ok((select count(*) from mcp_authenticate(repeat('b',64))) = 0, 'unknown token -> no rows');
select ok((select last_used_at from mcp_tokens where id = :'t1') is not null, 'last_used_at recorded');
update mcp_tokens set last_used_at = now() - interval '10 seconds' where id = :'t1';
select mcp_authenticate(repeat('a',64)) is not null as _;
select ok((select now() - last_used_at > interval '5 seconds' from mcp_tokens where id = :'t1'), 'last_used_at is throttled (not rewritten within a minute)');
insert into user_plans(user_id, plan, current_period_end) values (:'A', 'pro', now() + interval '10 days');
select ok((select tier from mcp_authenticate(repeat('a',64))) = 'pro', 'active pro plan -> pro');
update user_plans set current_period_end = now() - interval '1 day';
select ok((select tier from mcp_authenticate(repeat('a',64))) = 'free', 'expired pro plan -> free');
update user_plans set plan = 'team', current_period_end = null;
select ok((select tier from mcp_authenticate(repeat('a',64))) = 'pro', 'team plan without expiry -> pro');
update mcp_tokens set revoked_at = now() where id = :'t1';
select ok((select count(*) from mcp_authenticate(repeat('a',64))) = 0, 'revoked token stops working immediately');
update mcp_tokens set revoked_at = null, expires_at = now() - interval '1 second' where id = :'t1';
select ok((select count(*) from mcp_authenticate(repeat('a',64))) = 0, 'expired token stops working');
-- token cap
update mcp_tokens set revoked_at = now() where user_id = :'A';          -- start clean: revoked tokens must not count toward the cap
select count(mcp_issue_token(:'A', 'n'||i, repeat(to_hex(i), 64)::text, 'p')) from generate_series(1,5) i;
do $$ begin begin perform mcp_issue_token('00000000-0000-0000-0000-00000000000a', 'x', repeat('9',64), 'p'); perform mcp_issue_token('00000000-0000-0000-0000-00000000000a', 'y', repeat('8',64), 'p'); raise exception 'FAIL: cap not enforced'; exception when others then if sqlerrm <> 'too_many_tokens' then raise; end if; end; end $$;
select ok((select count(*) from mcp_tokens where user_id = :'A' and revoked_at is null) = 5, 'max 5 active tokens per user (revoked ones do not count)');
select ok(not exists (select 1 from mcp_tokens where token_hash !~ '^[0-9a-f]{64}$'), 'only 64-hex hashes are stored');
-- metering: free limit 50
do $$ declare i int; r jsonb; begin
  for i in 1..50 loop r := mcp_meter('00000000-0000-0000-0000-00000000000b', 50, 1000); if not (r->>'allowed')::boolean then raise exception 'FAIL: call % denied early', i; end if; end loop;
  if (r->>'used')::int <> 50 then raise exception 'FAIL: used=%', r->>'used'; end if;
  r := mcp_meter('00000000-0000-0000-0000-00000000000b', 50, 1000);
  if (r->>'allowed')::boolean or r->>'reason' <> 'monthly' or (r->>'used')::int <> 50 then raise exception 'FAIL: 51st call: %', r; end if;
  r := mcp_meter('00000000-0000-0000-0000-00000000000b', 50, 1000);
  if (select requests from mcp_usage where user_id = '00000000-0000-0000-0000-00000000000b') <> 50 then raise exception 'FAIL: denied calls must not increment'; end if;
  raise notice 'ok   free: exactly 50 allowed, the 51st is denied and not counted';
end $$;
select mcp_unmeter(:'B');
select ok((mcp_meter(:'B', 50, 1000)->>'allowed')::boolean, 'refund frees one slot');
select ok(not (mcp_meter(:'B', 50, 1000)->>'allowed')::boolean, '... and only one');
-- unlimited still counts
do $$ declare i int; r jsonb; begin for i in 1..120 loop r := mcp_meter('00000000-0000-0000-0000-00000000000a', null, 100000); end loop;
  if (r->>'allowed')::boolean is not true or (r->>'used')::int <> 120 or r->'limit' <> 'null'::jsonb then raise exception 'FAIL: pro %', r; end if; raise notice 'ok   pro: unlimited, usage still counted'; end $$;
-- burst
delete from mcp_burst;
do $$ declare i int; r jsonb; before int; begin
  select requests into before from mcp_usage where user_id = '00000000-0000-0000-0000-00000000000a';
  for i in 1..60 loop r := mcp_meter('00000000-0000-0000-0000-00000000000a', null, 60); end loop;
  if not (r->>'allowed')::boolean then raise exception 'FAIL: 60th in a minute should pass'; end if;
  r := mcp_meter('00000000-0000-0000-0000-00000000000a', null, 60);
  if (r->>'allowed')::boolean or r->>'reason' <> 'burst' or (r->>'retry_after')::int not between 1 and 60 then raise exception 'FAIL: burst %', r; end if;
  if (select requests from mcp_usage where user_id = '00000000-0000-0000-0000-00000000000a') <> before + 60 then raise exception 'FAIL: burst-rejected call burned monthly quota'; end if;
  raise notice 'ok   burst: 61st call/minute rejected with retry_after, monthly quota untouched';
end $$;
-- permissions
set role authenticated;
do $$ begin begin perform mcp_meter('00000000-0000-0000-0000-00000000000b', 1, 1); raise exception 'FAIL: callable by authenticated'; exception when insufficient_privilege then null; end; end $$;
do $$ begin begin perform * from mcp_tokens; raise exception 'FAIL: tokens readable by authenticated'; exception when insufficient_privilege then null; end; end $$;
do $$ begin begin perform mcp_authenticate(repeat('a',64)); raise exception 'FAIL: authenticate callable by authenticated'; exception when insufficient_privilege then null; end; end $$;
reset role;
select ok(true, 'authenticated/anon cannot call the functions or read tokens/usage');
set role anon;
do $$ begin begin perform * from user_plans; raise exception 'FAIL: plans readable by anon'; exception when insufficient_privilege then null; end; end $$;
reset role;
select ok(true, 'anon cannot read plans');
select 'ALL PASSED';
