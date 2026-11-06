alter table auth.users add column if not exists created_at timestamptz not null default now();  -- real Supabase has this column
-- Minimal copy of plan-gating/sql/016 pieces used here (user_subscriptions + effective_plan). In production use the real 016.
create table if not exists user_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free','pro','team')),
  status text not null default 'active' check (status in ('active','trialing','past_due','canceled','incomplete','paused')),
  current_period_end timestamptz, monthly_price_usd numeric(8,2), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create or replace function effective_plan(p_user uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select case when s.plan in ('pro','team') and s.status in ('active','trialing') and (s.current_period_end is null or s.current_period_end > now()) then s.plan else 'free' end
    from user_subscriptions s where s.user_id = p_user), 'free') $$;
alter table user_subscriptions enable row level security;
