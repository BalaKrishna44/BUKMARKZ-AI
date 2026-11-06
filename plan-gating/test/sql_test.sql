\set ON_ERROR_STOP on
create or replace function ok(c boolean, m text) returns void language plpgsql as $$ begin if not c then raise exception 'FAIL: %', m; end if; raise notice 'ok   %', m; end $$;
set client_min_messages = notice;
\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set C '00000000-0000-0000-0000-00000000000c'
\set D1 '00000000-0000-0000-0000-0000000000d1'
\set D2 '00000000-0000-0000-0000-0000000000d2'
insert into auth.users values (:'A'),(:'B'),(:'C') on conflict do nothing;
select $j${"free":{"ask":20,"mcp":50,"index":300,"snapshot":0},"pro":{"ask":1000,"mcp":10000,"index":25000,"snapshot":500},"team":{"ask":1500,"mcp":10000,"index":25000,"snapshot":1000}}$j$ as lim \gset
select set_config('t.lim', :'lim', false) as _;

-- migration path from a live 013 deployment
select ok((select plan from user_subscriptions where user_id = :'D1') = 'pro' and (select plan from user_subscriptions where user_id = :'D2') = 'team', '013 user_plans rows migrated into user_subscriptions');
select ok((select plan from user_plans where user_id = :'D1') = 'pro', 'old name user_plans still readable (view)');
select ok(to_regclass('user_plans_legacy') is not null, 'old table kept as user_plans_legacy');
select ok((select mcp_call_count from monthly_usage_meters where user_id = :'D1') = 37, 'this month''s mcp_usage carried into the new meter');

-- effective_plan
select ok(effective_plan(:'A') = 'free', 'no subscription -> free');
select ok(effective_plan(gen_random_uuid()) = 'free', 'unknown user -> free, no error');
insert into user_subscriptions(user_id, plan, status, current_period_end) values (:'A', 'pro', 'active', now() + interval '5 days');
select ok(effective_plan(:'A') = 'pro', 'active pro -> pro');
update user_subscriptions set status = 'trialing' where user_id = :'A';
select ok(effective_plan(:'A') = 'pro', 'trialing pro -> pro');
update user_subscriptions set status = 'active', current_period_end = now() - interval '1 hour';
select ok(effective_plan(:'A') = 'free', 'expired pro -> free');
update user_subscriptions set status = 'past_due', current_period_end = now() - interval '1 day' where user_id = :'A';
select ok(effective_plan(:'A') = 'pro', 'past_due within 3-day grace -> still pro');
update user_subscriptions set current_period_end = now() - interval '4 days' where user_id = :'A';
select ok(effective_plan(:'A') = 'free', 'past_due after grace -> free');
update user_subscriptions set status = 'canceled', current_period_end = now() + interval '5 days' where user_id = :'A';
select ok(effective_plan(:'A') = 'free', 'canceled -> free');
update user_subscriptions set plan = 'team', status = 'active', current_period_end = null where user_id = :'A';
select ok(effective_plan(:'A') = 'team', 'team without expiry -> team');
delete from user_subscriptions where user_id = :'A';

-- gate: ask limit 20 (free)
do $$ declare i int; r jsonb; lim jsonb := current_setting('t.lim')::jsonb; begin
  for i in 1..20 loop r := gate_consume('00000000-0000-0000-0000-00000000000b', 'ask', 1, lim); if not (r->>'allowed')::boolean then raise exception 'FAIL: ask % denied early: %', i, r; end if; end loop;
  if (r->>'used')::int <> 20 then raise exception 'FAIL: used %', r; end if;
  r := gate_consume('00000000-0000-0000-0000-00000000000b', 'ask', 1, lim);
  if (r->>'allowed')::boolean or r->>'reason' <> 'monthly' or (r->>'used')::int <> 20 or (r->>'limit')::int <> 20 then raise exception 'FAIL: 21st: %', r; end if;
  if (select ask_count from monthly_usage_meters where user_id = '00000000-0000-0000-0000-00000000000b' and month_year = to_char(now() at time zone 'utc','YYYY-MM')) <> 20 then raise exception 'FAIL: denied call counted'; end if;
  raise notice 'ok   free ask: exactly 20 allowed, 21st denied (reason monthly) and not counted';
end $$;

-- gate: rules around the edges
select ok((gate_consume(:'C', 'snapshot', 1, :'lim'::jsonb)->>'reason') = 'plan', 'limit 0 on this plan -> reason plan');
select ok(not (gate_consume(:'C', 'ask', 21, :'lim'::jsonb)->>'allowed')::boolean, 'amount larger than the cap is denied even as first insert');
do $$ begin begin perform gate_consume('00000000-0000-0000-0000-00000000000c', 'teleport', 1, current_setting('t.lim')::jsonb); raise exception 'FAIL: bad feature accepted'; exception when others then if sqlerrm <> 'invalid_feature' then raise; end if; end; raise notice 'ok   unknown feature rejected'; end $$;
do $$ begin begin perform gate_consume('00000000-0000-0000-0000-00000000000c', 'ask', 0, current_setting('t.lim')::jsonb); raise exception 'FAIL'; exception when others then if sqlerrm <> 'invalid_amount' then raise; end if; end; raise notice 'ok   amount < 1 rejected'; end $$;
do $$ begin begin perform gate_consume('00000000-0000-0000-0000-00000000000c', 'ask', 1, null); raise exception 'FAIL'; exception when others then if sqlerrm <> 'invalid_limits' then raise; end if; end; raise notice 'ok   missing limits rejected'; end $$;
select ok((gate_consume(:'C', 'ask', 1, '{"free":{}}'::jsonb)->>'reason') = 'not_configured', 'feature absent from the table -> denied (fail closed)');
do $$ begin begin perform gate_consume('00000000-0000-0000-0000-00000000000c', 'ask', 1, '{"free":{"ask":-1}}'); raise exception 'FAIL'; exception when others then if sqlerrm <> 'invalid_limits' then raise; end if; end; raise notice 'ok   negative limit rejected'; end $$;
select ok((gate_consume(:'C', 'mcp', 3, '{"free":{"mcp":null}}'::jsonb)->>'allowed')::boolean and (select mcp_call_count from monthly_usage_meters where user_id = :'C') = 3, 'null limit = unlimited but usage counted');
insert into user_subscriptions(user_id, plan, status, current_period_end) values (:'C', 'pro', 'active', now() + interval '3 days');
select ok((gate_consume(:'C', 'ask', 1, :'lim'::jsonb)->>'limit')::int = 1000 and (gate_consume(:'C', 'snapshot', 1, :'lim'::jsonb)->>'allowed')::boolean, 'pro user gets pro caps (ask 1000, snapshots allowed)');
select gate_refund(:'C', 'ask', 1);
select ok((select ask_count from monthly_usage_meters where user_id = :'C' and month_year = to_char(now() at time zone 'utc','YYYY-MM')) = 0, 'refund gives the unit back');
select gate_refund(:'C', 'ask', 50);
select ok((select ask_count from monthly_usage_meters where user_id = :'C' and month_year = to_char(now() at time zone 'utc','YYYY-MM')) = 0, 'refund never goes below zero');
do $$ declare r jsonb; lim jsonb := current_setting('t.lim')::jsonb; u uuid := '00000000-0000-0000-0000-00000000000a'; begin
  r := gate_consume(u, 'index', 250, lim, false);
  if not (r->>'allowed')::boolean or (r->>'used')::int <> 250 then raise exception 'FAIL: %', r; end if;
  r := gate_consume(u, 'index', 100, lim, false);
  if (r->>'allowed')::boolean or r->>'reason' <> 'total' or (r->>'granted')::int <> 0 then raise exception 'FAIL: all-or-nothing: %', r; end if;
  r := gate_consume(u, 'index', 100, lim, true);
  if not (r->>'allowed')::boolean or (r->>'granted')::int <> 50 or not (r->>'partial')::boolean then raise exception 'FAIL: partial: %', r; end if;
  r := gate_consume(u, 'index', 1, lim, true);
  if (r->>'allowed')::boolean or r->>'reason' <> 'total' then raise exception 'FAIL: full: %', r; end if;
  perform gate_release_index(u, 40);
  r := gate_consume(u, 'index', 40, lim, false);
  if not (r->>'allowed')::boolean then raise exception 'FAIL: freed capacity: %', r; end if;
  perform gate_refund(u, 'index', 10);
  if (select indexed_total from ai_index_state where user_id = u) <> 290 then raise exception 'FAIL: total after refund'; end if;
  perform gate_set_indexed_total(u, 12);
  if (gate_usage(u, lim)->'features'->'index'->>'used')::int <> 12 then raise exception 'FAIL: reconcile'; end if;
  raise notice 'ok   index: stock cap, all-or-nothing vs partial grants, release/refund/reconcile';
end $$;
select ok((gate_usage(:'B', :'lim'::jsonb)->'features'->'ask'->>'used')::int = 20 and gate_usage(:'B', :'lim'::jsonb)->>'plan' = 'free', 'gate_usage reports plan and counters');

select mcp_issue_token(:'B', 'Cursor', repeat('a',64), 'abcdef') as t \gset
select ok((select tier from mcp_authenticate(repeat('a',64))) = 'free', 'mcp_authenticate: free by default');
insert into user_subscriptions(user_id, plan, status, current_period_end) values (:'B', 'pro', 'active', now() + interval '3 days');
select ok((select tier from mcp_authenticate(repeat('a',64))) = 'pro', 'mcp_authenticate: pro via user_subscriptions');
delete from user_subscriptions where user_id = :'B';
do $$ declare i int; r jsonb; u uuid := '00000000-0000-0000-0000-0000000000e1'; begin
  insert into auth.users values (u);
  for i in 1..50 loop r := mcp_meter(u, 50, 1000); if not (r->>'allowed')::boolean then raise exception 'FAIL: call % denied early', i; end if; end loop;
  r := mcp_meter(u, 50, 1000);
  if (r->>'allowed')::boolean or r->>'reason' <> 'monthly' or (r->>'used')::int <> 50 then raise exception 'FAIL: 51st %', r; end if;
  perform mcp_unmeter(u);
  if not (mcp_meter(u, 50, 1000)->>'allowed')::boolean then raise exception 'FAIL: unmeter'; end if;
  r := mcp_meter(u, null, 1000);
  if not (r->>'allowed')::boolean or (r->>'used')::int <> 51 then raise exception 'FAIL: unlimited %', r; end if;
  raise notice 'ok   mcp_meter: 50 allowed, 51st denied, unmeter refunds, null = unlimited';
end $$;
do $$ declare i int; r jsonb; u uuid := '00000000-0000-0000-0000-0000000000e2'; begin
  insert into auth.users values (u);
  for i in 1..5 loop r := mcp_meter(u, 100, 5); end loop;
  r := mcp_meter(u, 100, 5);
  if (r->>'allowed')::boolean or r->>'reason' <> 'burst' or (r->>'retry_after')::int < 1 then raise exception 'FAIL: burst %', r; end if;
  if (select mcp_call_count from monthly_usage_meters where user_id = u) <> 5 then raise exception 'FAIL: burst-denied call burned monthly quota'; end if;
  raise notice 'ok   burst limit denies with retry_after and does not burn monthly quota';
end $$;

select ai_ledger_record(:'C', 'ask', 'claude-haiku-5-5', 1000, 200, 0.0002) as _ \gset
select ok(ai_ledger_record(:'C', 'ask', 'claude-sonnet-5-5', 2000, 500, 0.01, true, 'budget_degraded') = 0.0102, 'ledger insert returns running monthly total');
select ok((select count(*) from ai_usage_ledger where user_id = :'C') = 2 and (select degraded from ai_usage_ledger where user_id = :'C' order by id desc limit 1), 'ledger rows appended with degraded flag');
select ok((ai_budget_state(:'C')->>'spent_usd')::numeric = 0.0102 and ai_budget_state(:'C')->>'plan' = 'pro', 'budget state: plan + spend');
select ok(ai_global_spend() >= 0.0102, 'global spend sums all users');
select ai_cache_set(:'C', 'key-12345678', 'hello', 3600, 'm');
select ok(ai_cache_get(:'C', 'key-12345678') = 'hello' and ai_cache_get(:'B', 'key-12345678') is null, 'cache hit for owner only');
update ai_response_cache set expires_at = now() - interval '1 second';
select ok(ai_cache_get(:'C', 'key-12345678') is null and ai_cache_prune() = 1, 'expired entries invisible and pruned');
do $$ begin begin perform ai_ledger_record('00000000-0000-0000-0000-00000000000c', 'Bad Feature!', 'm', 1, 1, 0); raise exception 'FAIL'; exception when check_violation then null; end; raise notice 'ok   feature_name format enforced'; end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', :'C', false);
select ok((select count(*) from ai_usage_ledger) = 2, 'user reads own ledger rows (RLS)');
select ok((select count(*) from monthly_usage_meters) = 1 and (select count(*) from user_subscriptions) = 1, 'user sees only own meters and subscription');
do $$ begin begin perform gate_consume('00000000-0000-0000-0000-00000000000c', 'ask', 1, '{"free":{"ask":1}}'); raise exception 'FAIL: callable by user'; exception when insufficient_privilege then null; end; raise notice 'ok   authenticated cannot call gate_consume'; end $$;
do $$ begin begin update user_subscriptions set plan = 'team'; raise exception 'FAIL: user can write subscription'; exception when insufficient_privilege then null; end; raise notice 'ok   authenticated cannot write subscriptions'; end $$;
do $$ begin begin insert into ai_usage_ledger(user_id, feature_name, model_used, cost_usd) values ('00000000-0000-0000-0000-00000000000c','x','m',0); raise exception 'FAIL'; exception when insufficient_privilege then null; end; raise notice 'ok   authenticated cannot write the ledger'; end $$;
do $$ begin begin perform ai_cache_get('00000000-0000-0000-0000-00000000000b', 'key-12345678'); raise exception 'FAIL'; exception when insufficient_privilege then null; end; raise notice 'ok   authenticated cannot call cache RPCs'; end $$;
reset role;
set role anon;
do $$ begin begin perform count(*) from user_plans; raise exception 'FAIL: anon reads view'; exception when insufficient_privilege then null; end; raise notice 'ok   anon cannot read user_plans view'; end $$;
reset role;
