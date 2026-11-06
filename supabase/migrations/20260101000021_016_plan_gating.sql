-- 016: Plan gating, usage meters and the AI cost ledger. Run after 013_mcp.sql.
-- Replaces user_plans (table -> read-only view) and mcp_usage (stops being written) so there is ONE source of truth for "what plan is this user on"
-- and "how much have they used". Everything here is service-role only except read-your-own-row selects for the settings page.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Subscriptions. Your billing webhook (Stripe/Razorpay/...) upserts this table; nothing else writes it.
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists user_subscriptions (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  plan               text not null default 'free' check (plan in ('free','pro','team')),
  status             text not null default 'active' check (status in ('active','trialing','past_due','canceled','incomplete','paused')),
  current_period_end timestamptz,                                  -- null = no expiry (lifetime / managed elsewhere)
  monthly_price_usd  numeric(8,2) check (monthly_price_usd is null or monthly_price_usd >= 0),  -- what this user really pays per month (annual = price/12; team = per seat). null = list price
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create or replace function _touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists user_subscriptions_touch on user_subscriptions;
create trigger user_subscriptions_touch before update on user_subscriptions for each row execute function _touch_updated_at();

-- Migrate 013's user_plans: copy rows, keep the old table as user_plans_legacy, and leave a read-only view under the old name
-- so the existing settings page query (select plan from user_plans) keeps working. Re-running is a no-op.
do $$ begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'user_plans' and c.relkind = 'r') then
    insert into user_subscriptions(user_id, plan, status, current_period_end)
      select user_id, plan, 'active', current_period_end from user_plans on conflict (user_id) do nothing;
    alter table user_plans rename to user_plans_legacy;
  end if;
end $$;
create or replace view user_plans with (security_invoker = true) as
  select user_id, plan, current_period_end, updated_at from user_subscriptions;

-- The plan a user is entitled to RIGHT NOW. Paid plans need an active/trialing subscription that has not expired;
-- past_due keeps access for 3 days after the period end (card retries) and then drops to free. Never raises: unknown user = free.
create or replace function effective_plan(p_user uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce((
    select case when s.plan in ('pro','team') and (
             (s.status in ('active','trialing') and (s.current_period_end is null or s.current_period_end > now()))
          or (s.status = 'past_due' and s.current_period_end is not null and s.current_period_end + interval '3 days' > now()))
           then s.plan else 'free' end
    from user_subscriptions s where s.user_id = p_user), 'free');
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Meters. One row per user per UTC month ("YYYY-MM").
--    ask / mcp / snapshots are monthly flows. ai_indexed_count is the number of items indexed THIS month (cost and analytics);
--    the cap on indexed items is a stock, kept in ai_index_state, because 300 indexed items must not become 300 per month.
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists monthly_usage_meters (
  user_id          uuid not null references auth.users(id) on delete cascade,
  month_year       text not null check (month_year ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  ai_indexed_count int  not null default 0 check (ai_indexed_count >= 0),
  ask_count        int  not null default 0 check (ask_count >= 0),
  mcp_call_count   int  not null default 0 check (mcp_call_count >= 0),
  snapshots_count  int  not null default 0 check (snapshots_count >= 0),
  ai_cost_usd      numeric(12,6) not null default 0 check (ai_cost_usd >= 0),   -- running LLM spend this month, kept in step with the ledger
  updated_at       timestamptz not null default now(),
  primary key (user_id, month_year)
);
create table if not exists ai_index_state (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  indexed_total int not null default 0 check (indexed_total >= 0),
  updated_at    timestamptz not null default now()
);

-- Carry this month's MCP usage over from 013 so nobody gets a fresh quota on deploy day.
do $$ begin
  if to_regclass('public.mcp_usage') is not null then
    insert into monthly_usage_meters(user_id, month_year, mcp_call_count)
      select user_id, to_char(period, 'YYYY-MM'), requests from mcp_usage where period = date_trunc('month', now() at time zone 'utc')::date
    on conflict (user_id, month_year) do update set mcp_call_count = greatest(monthly_usage_meters.mcp_call_count, excluded.mcp_call_count);
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. AI cost ledger (append-only) and a small per-user response cache.
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists ai_usage_ledger (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  feature_name  text not null check (feature_name ~ '^[a-z0-9_.-]{1,60}$'),
  model_used    text not null check (char_length(model_used) between 1 and 80),
  input_tokens  int  not null default 0 check (input_tokens >= 0),
  output_tokens int  not null default 0 check (output_tokens >= 0),
  cost_usd      numeric(12,6) not null check (cost_usd >= 0),
  degraded      boolean not null default false,                       -- the circuit breaker swapped the model or capped the request
  reason        text check (reason is null or char_length(reason) <= 80),
  created_at    timestamptz not null default now()
);
create index if not exists ai_usage_ledger_user_idx on ai_usage_ledger (user_id, created_at desc);
create index if not exists ai_usage_ledger_time_idx on ai_usage_ledger (created_at);

create table if not exists ai_response_cache (
  user_id    uuid not null references auth.users(id) on delete cascade,
  cache_key  text not null check (char_length(cache_key) between 8 and 128),
  response   text not null check (char_length(response) <= 20000),
  model_used text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (user_id, cache_key)
);
create index if not exists ai_response_cache_exp_idx on ai_response_cache (expires_at);

alter table user_subscriptions    enable row level security;
alter table monthly_usage_meters  enable row level security;
alter table ai_index_state        enable row level security;
alter table ai_usage_ledger       enable row level security;
alter table ai_response_cache     enable row level security;
revoke all on user_subscriptions, monthly_usage_meters, ai_index_state, ai_usage_ledger, ai_response_cache from anon, authenticated;
revoke all on user_plans from anon;
grant select on user_subscriptions, monthly_usage_meters, ai_usage_ledger to authenticated;      -- "my plan", "my usage"; writes are server-only
grant select on user_plans to authenticated;
drop policy if exists user_subscriptions_owner on user_subscriptions;
create policy user_subscriptions_owner on user_subscriptions for select to authenticated using (user_id = auth.uid());
drop policy if exists monthly_usage_meters_owner on monthly_usage_meters;
create policy monthly_usage_meters_owner on monthly_usage_meters for select to authenticated using (user_id = auth.uid());
drop policy if exists ai_usage_ledger_owner on ai_usage_ledger;
create policy ai_usage_ledger_owner on ai_usage_ledger for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. The gate. p_limits is the whole plan table from lib/planLimits.ts (single source of truth):
--      {"free":{"ask":20,"mcp":50,"index":300,"snapshot":0}, "pro":{...}, "team":{...}}   (JSON null = unlimited, a missing key = not allowed)
--    The check and the increment are ONE statement, so parallel callers cannot overshoot a cap.
--    Returns {allowed, plan, feature, used, limit, reason?, granted?}. reason: 'monthly' | 'total' | 'plan' (limit is 0 on this plan) | 'not_configured'.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function gate_consume(p_user uuid, p_feature text, p_amount int default 1, p_limits jsonb default null, p_partial boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare plan text; m text := to_char(now() at time zone 'utc', 'YYYY-MM'); col text; lj jsonb; lim int; used int; grant_n int;
begin
  if p_user is null then raise exception 'not_authenticated'; end if;
  col := case p_feature when 'ask' then 'ask_count' when 'mcp' then 'mcp_call_count' when 'index' then 'ai_indexed_count' when 'snapshot' then 'snapshots_count' end;
  if col is null then raise exception 'invalid_feature'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 100000 then raise exception 'invalid_amount'; end if;
  if p_limits is null or jsonb_typeof(p_limits) <> 'object' then raise exception 'invalid_limits'; end if;

  plan := effective_plan(p_user);
  lj := p_limits -> plan -> p_feature;
  if lj is null then return jsonb_build_object('allowed', false, 'plan', plan, 'feature', p_feature, 'reason', 'not_configured', 'used', 0, 'limit', 0); end if;   -- fail closed
  lim := case when jsonb_typeof(lj) = 'number' then (lj #>> '{}')::int end;             -- null = unlimited (usage is still counted)
  if jsonb_typeof(lj) not in ('number', 'null') or (lim is not null and lim < 0) then raise exception 'invalid_limits'; end if;

  if p_feature = 'index' then
    insert into ai_index_state(user_id) values (p_user) on conflict (user_id) do nothing;
    select indexed_total into used from ai_index_state where user_id = p_user for update;       -- row lock serialises parallel importers
    grant_n := case when lim is null then p_amount else least(p_amount, greatest(lim - used, 0)) end;
    if grant_n < p_amount and not p_partial then grant_n := 0; end if;
    if grant_n = 0 then
      return jsonb_build_object('allowed', false, 'plan', plan, 'feature', p_feature, 'reason', case when lim = 0 then 'plan' else 'total' end, 'used', used, 'limit', lim, 'granted', 0);
    end if;
    update ai_index_state set indexed_total = indexed_total + grant_n, updated_at = now() where user_id = p_user returning indexed_total into used;
    insert into monthly_usage_meters(user_id, month_year, ai_indexed_count) values (p_user, m, grant_n)
      on conflict (user_id, month_year) do update set ai_indexed_count = monthly_usage_meters.ai_indexed_count + grant_n, updated_at = now();
    return jsonb_build_object('allowed', true, 'plan', plan, 'feature', p_feature, 'used', used, 'limit', lim, 'granted', grant_n, 'partial', grant_n < p_amount);
  end if;

  if lim is not null and p_amount > lim then       -- would never fit, and a first INSERT must not slip past the limit
    select coalesce((select case col when 'ask_count' then ask_count when 'mcp_call_count' then mcp_call_count else snapshots_count end from monthly_usage_meters where user_id = p_user and month_year = m), 0) into used;
    return jsonb_build_object('allowed', false, 'plan', plan, 'feature', p_feature, 'reason', case when lim = 0 then 'plan' else 'monthly' end, 'used', used, 'limit', lim);
  end if;
  execute format('insert into monthly_usage_meters as t (user_id, month_year, %1$I) values ($1, $2, $3)
                  on conflict (user_id, month_year) do update set %1$I = t.%1$I + $3, updated_at = now()
                  where $4::int is null or t.%1$I + $3 <= $4::int returning t.%1$I', col) into used using p_user, m, p_amount, lim;
  if used is null then
    execute format('select %I from monthly_usage_meters where user_id = $1 and month_year = $2', col) into used using p_user, m;
    return jsonb_build_object('allowed', false, 'plan', plan, 'feature', p_feature, 'reason', case when lim = 0 then 'plan' else 'monthly' end, 'used', coalesce(used, 0), 'limit', lim);
  end if;
  return jsonb_build_object('allowed', true, 'plan', plan, 'feature', p_feature, 'used', used, 'limit', lim, 'granted', p_amount);
end $$;

-- Give back usage when WE failed (not the caller). Indexing returns capacity as well as the monthly count.
create or replace function gate_refund(p_user uuid, p_feature text, p_amount int default 1) returns void language plpgsql security definer set search_path = public as $$
declare m text := to_char(now() at time zone 'utc', 'YYYY-MM');
begin
  if p_amount is null or p_amount < 1 then return; end if;
  case p_feature
    when 'ask'      then update monthly_usage_meters set ask_count = greatest(ask_count - p_amount, 0), updated_at = now() where user_id = p_user and month_year = m;
    when 'mcp'      then update monthly_usage_meters set mcp_call_count = greatest(mcp_call_count - p_amount, 0), updated_at = now() where user_id = p_user and month_year = m;
    when 'snapshot' then update monthly_usage_meters set snapshots_count = greatest(snapshots_count - p_amount, 0), updated_at = now() where user_id = p_user and month_year = m;
    when 'index'    then
      update monthly_usage_meters set ai_indexed_count = greatest(ai_indexed_count - p_amount, 0), updated_at = now() where user_id = p_user and month_year = m;
      update ai_index_state set indexed_total = greatest(indexed_total - p_amount, 0), updated_at = now() where user_id = p_user;
    else raise exception 'invalid_feature';
  end case;
end $$;

-- Deleting indexed items frees capacity (call with the number removed). set_indexed_total reconciles drift from the real count (nightly job).
create or replace function gate_release_index(p_user uuid, p_count int) returns void language sql security definer set search_path = public as $$
  update ai_index_state set indexed_total = greatest(indexed_total - greatest(p_count, 0), 0), updated_at = now() where user_id = p_user;
$$;
create or replace function gate_set_indexed_total(p_user uuid, p_total int) returns void language sql security definer set search_path = public as $$
  insert into ai_index_state(user_id, indexed_total) values (p_user, greatest(p_total, 0))
  on conflict (user_id) do update set indexed_total = greatest(p_total, 0), updated_at = now();
$$;

-- Everything the settings page and the upgrade prompts need, in one call.
create or replace function gate_usage(p_user uuid, p_limits jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare plan text := effective_plan(p_user); m text := to_char(now() at time zone 'utc', 'YYYY-MM'); r monthly_usage_meters; tot int;
begin
  select * into r from monthly_usage_meters where user_id = p_user and month_year = m;
  select indexed_total into tot from ai_index_state where user_id = p_user;
  return jsonb_build_object('plan', plan, 'month', m, 'features', jsonb_build_object(
    'ask',      jsonb_build_object('used', coalesce(r.ask_count, 0),       'limit', p_limits -> plan -> 'ask'),
    'mcp',      jsonb_build_object('used', coalesce(r.mcp_call_count, 0),  'limit', p_limits -> plan -> 'mcp'),
    'index',    jsonb_build_object('used', coalesce(tot, 0),               'limit', p_limits -> plan -> 'index'),
    'snapshot', jsonb_build_object('used', coalesce(r.snapshots_count, 0), 'limit', p_limits -> plan -> 'snapshot')));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. MCP rewired onto the new tables. Same signatures as 013, so the route and tests keep working.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function mcp_authenticate(p_hash text)
returns table (user_id uuid, token_id uuid, tier text) language plpgsql security definer set search_path = public as $$
begin
  return query
  select t.user_id, t.id, case when effective_plan(t.user_id) in ('pro','team') then 'pro' else 'free' end
  from mcp_tokens t
  where t.token_hash = p_hash and t.revoked_at is null and (t.expires_at is null or t.expires_at > now());
  update mcp_tokens set last_used_at = now()
   where token_hash = p_hash and revoked_at is null and (last_used_at is null or last_used_at < now() - interval '1 minute');
end $$;

-- Burst first (a burst-rejected call must not burn monthly quota), then the atomic monthly increment in monthly_usage_meters.
create or replace function mcp_meter(p_user uuid, p_monthly_limit int, p_burst_limit int default 60)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m timestamptz := date_trunc('minute', now()); b int; used int; per text := to_char(now() at time zone 'utc', 'YYYY-MM');
begin
  delete from mcp_burst where user_id = p_user and minute < now() - interval '1 hour';
  insert into mcp_burst(user_id, minute, n) values (p_user, m, 1)
    on conflict (user_id, minute) do update set n = mcp_burst.n + 1 returning n into b;
  if b > p_burst_limit then
    return jsonb_build_object('allowed', false, 'reason', 'burst', 'retry_after', greatest(1, ceil(extract(epoch from (m + interval '1 minute' - now())))::int));
  end if;
  if p_monthly_limit is not null and p_monthly_limit < 1 then
    return jsonb_build_object('allowed', false, 'reason', 'monthly', 'used', 0, 'limit', p_monthly_limit);
  end if;
  insert into monthly_usage_meters as t (user_id, month_year, mcp_call_count) values (p_user, per, 1)
    on conflict (user_id, month_year) do update set mcp_call_count = t.mcp_call_count + 1, updated_at = now()
    where p_monthly_limit is null or t.mcp_call_count < p_monthly_limit
    returning t.mcp_call_count into used;
  if used is null then
    select mcp_call_count into used from monthly_usage_meters where user_id = p_user and month_year = per;
    return jsonb_build_object('allowed', false, 'reason', 'monthly', 'used', coalesce(used, 0), 'limit', p_monthly_limit);
  end if;
  return jsonb_build_object('allowed', true, 'used', used, 'limit', p_monthly_limit);
end $$;

create or replace function mcp_unmeter(p_user uuid) returns void language sql security definer set search_path = public as $$
  update monthly_usage_meters set mcp_call_count = greatest(mcp_call_count - 1, 0), updated_at = now()
   where user_id = p_user and month_year = to_char(now() at time zone 'utc', 'YYYY-MM');
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. AI cost ledger + budget state + cache.
-- ---------------------------------------------------------------------------------------------------------------------
-- One call writes the ledger row AND the running monthly total, so the breaker reads a single number. Returns this month's total for the user.
create or replace function ai_ledger_record(p_user uuid, p_feature text, p_model text, p_in int, p_out int, p_cost numeric, p_degraded boolean default false, p_reason text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare total numeric;
begin
  insert into ai_usage_ledger(user_id, feature_name, model_used, input_tokens, output_tokens, cost_usd, degraded, reason)
  values (p_user, p_feature, p_model, greatest(coalesce(p_in, 0), 0), greatest(coalesce(p_out, 0), 0), greatest(coalesce(p_cost, 0), 0), coalesce(p_degraded, false), left(p_reason, 80));
  insert into monthly_usage_meters as t (user_id, month_year, ai_cost_usd) values (p_user, to_char(now() at time zone 'utc', 'YYYY-MM'), greatest(coalesce(p_cost, 0), 0))
    on conflict (user_id, month_year) do update set ai_cost_usd = t.ai_cost_usd + greatest(coalesce(p_cost, 0), 0), updated_at = now()
    returning t.ai_cost_usd into total;
  return total;
end $$;

create or replace function ai_budget_state(p_user uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'plan', effective_plan(p_user),
    'monthly_price_usd', (select monthly_price_usd from user_subscriptions where user_id = p_user),
    'spent_usd', coalesce((select ai_cost_usd from monthly_usage_meters where user_id = p_user and month_year = to_char(now() at time zone 'utc', 'YYYY-MM')), 0));
$$;
create or replace function ai_global_spend() returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(ai_cost_usd), 0) from monthly_usage_meters where month_year = to_char(now() at time zone 'utc', 'YYYY-MM');
$$;

create or replace function ai_cache_get(p_user uuid, p_key text) returns text language sql stable security definer set search_path = public as $$
  select response from ai_response_cache where user_id = p_user and cache_key = p_key and expires_at > now();
$$;
create or replace function ai_cache_set(p_user uuid, p_key text, p_value text, p_ttl_seconds int default 86400, p_model text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into ai_response_cache(user_id, cache_key, response, model_used, expires_at)
  values (p_user, p_key, left(p_value, 20000), left(p_model, 80), now() + make_interval(secs => least(greatest(coalesce(p_ttl_seconds, 86400), 60), 604800)))
  on conflict (user_id, cache_key) do update set response = excluded.response, model_used = excluded.model_used, created_at = now(), expires_at = excluded.expires_at;
  delete from ai_response_cache where user_id = p_user and (expires_at <= now() or cache_key in (          -- keep each user's cache bounded: newest 500
    select cache_key from ai_response_cache where user_id = p_user order by created_at desc offset 500));
end $$;
create or replace function ai_cache_prune() returns int language sql security definer set search_path = public as $$
  with d as (delete from ai_response_cache where expires_at <= now() returning 1) select count(*)::int from d;
$$;

revoke all on function effective_plan(uuid), gate_consume(uuid,text,int,jsonb,boolean), gate_refund(uuid,text,int), gate_release_index(uuid,int), gate_set_indexed_total(uuid,int), gate_usage(uuid,jsonb),
  mcp_authenticate(text), mcp_meter(uuid,int,int), mcp_unmeter(uuid),
  ai_ledger_record(uuid,text,text,int,int,numeric,boolean,text), ai_budget_state(uuid), ai_global_spend(), ai_cache_get(uuid,text), ai_cache_set(uuid,text,text,int,text), ai_cache_prune()
  from public, anon, authenticated;
grant execute on function effective_plan(uuid), gate_consume(uuid,text,int,jsonb,boolean), gate_refund(uuid,text,int), gate_release_index(uuid,int), gate_set_indexed_total(uuid,int), gate_usage(uuid,jsonb),
  mcp_authenticate(text), mcp_meter(uuid,int,int), mcp_unmeter(uuid),
  ai_ledger_record(uuid,text,text,int,int,numeric,boolean,text), ai_budget_state(uuid), ai_global_spend(), ai_cache_get(uuid,text), ai_cache_set(uuid,text,text,int,text), ai_cache_prune()
  to service_role;
