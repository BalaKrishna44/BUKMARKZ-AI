-- 013: Vault MCP Pro — API tokens, plan lookup and atomic usage metering. Everything here is service-role only:
-- the MCP route authenticates with a bearer token (no Supabase session), so it runs as the server and always filters by the token's user.

-- Plan per user. Your billing webhook (Stripe/Razorpay/...) upserts this row; nothing else writes it.
create table if not exists user_plans (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  plan               text not null default 'free' check (plan in ('free','pro','team')),
  current_period_end timestamptz,                         -- null = no expiry (e.g. lifetime/trial managed elsewhere)
  updated_at         timestamptz not null default now()
);

-- API tokens: only the SHA-256 of the token is stored (tokens carry 256 random bits, so an unsalted fast hash is appropriate).
create table if not exists mcp_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 60),
  prefix       text not null,                              -- first characters of the secret part, for recognising it in a list
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz
);
create index if not exists mcp_tokens_user_idx on mcp_tokens(user_id, created_at desc);

create table if not exists mcp_usage (                    -- one row per user per UTC month
  user_id  uuid not null references auth.users(id) on delete cascade,
  period   date not null,
  requests int  not null default 0 check (requests >= 0),
  primary key (user_id, period)
);
create table if not exists mcp_burst (                    -- per-minute counter: a runaway agent loop must not hammer embeddings/DB, even on "unlimited"
  user_id uuid not null references auth.users(id) on delete cascade,
  minute  timestamptz not null,
  n       int not null default 0,
  primary key (user_id, minute)
);

alter table user_plans enable row level security;
alter table mcp_tokens enable row level security;
alter table mcp_usage  enable row level security;
alter table mcp_burst  enable row level security;
revoke all on user_plans, mcp_tokens, mcp_usage, mcp_burst from anon, authenticated;
grant select on user_plans to authenticated;              -- so the settings page can show "Pro"; writes are billing-only
drop policy if exists user_plans_owner on user_plans;
create policy user_plans_owner on user_plans for select to authenticated using (user_id = auth.uid());

-- Token -> user + effective tier. Revoked/expired/unknown all look identical (no rows). last_used_at is throttled to once a minute.
create or replace function mcp_authenticate(p_hash text)
returns table (user_id uuid, token_id uuid, tier text) language plpgsql security definer set search_path = public as $$
begin
  return query
  select t.user_id, t.id,
         case when p.plan in ('pro','team') and (p.current_period_end is null or p.current_period_end > now()) then 'pro' else 'free' end
  from mcp_tokens t left join user_plans p on p.user_id = t.user_id
  where t.token_hash = p_hash and t.revoked_at is null and (t.expires_at is null or t.expires_at > now());
  update mcp_tokens set last_used_at = now()
   where token_hash = p_hash and revoked_at is null and (last_used_at is null or last_used_at < now() - interval '1 minute');
end $$;

-- One metered request. Burst check first (a burst-rejected call must not burn monthly quota), then an ATOMIC conditional
-- increment: two parallel calls at 49/50 cannot both succeed. p_monthly_limit null = unlimited (usage is still counted).
create or replace function mcp_meter(p_user uuid, p_monthly_limit int, p_burst_limit int default 60)
returns jsonb language plpgsql security definer set search_path = public as $$
declare per date := date_trunc('month', now() at time zone 'utc')::date;
        m timestamptz := date_trunc('minute', now()); b int; used int;
begin
  delete from mcp_burst where user_id = p_user and minute < now() - interval '1 hour';
  insert into mcp_burst(user_id, minute, n) values (p_user, m, 1)
    on conflict (user_id, minute) do update set n = mcp_burst.n + 1 returning n into b;
  if b > p_burst_limit then
    return jsonb_build_object('allowed', false, 'reason', 'burst', 'retry_after', greatest(1, ceil(extract(epoch from (m + interval '1 minute' - now())))::int));
  end if;

  insert into mcp_usage(user_id, period, requests) values (p_user, per, 1)
    on conflict (user_id, period) do update set requests = mcp_usage.requests + 1
    where p_monthly_limit is null or mcp_usage.requests < p_monthly_limit
    returning requests into used;
  if used is null then
    select requests into used from mcp_usage where user_id = p_user and period = per;
    return jsonb_build_object('allowed', false, 'reason', 'monthly', 'used', used, 'limit', p_monthly_limit);
  end if;
  return jsonb_build_object('allowed', true, 'used', used, 'limit', p_monthly_limit);
end $$;

-- Give back one request when WE failed (not the caller).
create or replace function mcp_unmeter(p_user uuid) returns void language sql security definer set search_path = public as $$
  update mcp_usage set requests = greatest(requests - 1, 0)
   where user_id = p_user and period = date_trunc('month', now() at time zone 'utc')::date;
$$;

-- Issue: max 5 active tokens per user, atomically.
create or replace function mcp_issue_token(p_user uuid, p_name text, p_hash text, p_prefix text) returns uuid
language plpgsql security definer set search_path = public as $$
declare id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('mcp_issue:' || p_user::text, 0));      -- serialise per user so two clicks can't both pass the cap
  if (select count(*) from mcp_tokens where user_id = p_user and revoked_at is null) >= 5 then raise exception 'too_many_tokens'; end if;
  insert into mcp_tokens(user_id, name, token_hash, prefix) values (p_user, btrim(p_name), p_hash, p_prefix) returning mcp_tokens.id into id;
  return id;
end $$;

revoke all on function mcp_authenticate(text), mcp_meter(uuid,int,int), mcp_unmeter(uuid), mcp_issue_token(uuid,text,text,text) from public, anon, authenticated;
grant execute on function mcp_authenticate(text), mcp_meter(uuid,int,int), mcp_unmeter(uuid), mcp_issue_token(uuid,text,text,text) to service_role;
