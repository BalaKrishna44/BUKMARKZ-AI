-- 021: referrals. Reward = +30 days of Pro for BOTH people, granted only after the new user has really used the product.
-- Run after plan-gating/sql/016 (user_subscriptions, effective_plan) and importexport/001.
create table if not exists referral_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code    text not null unique check (code ~ '^[a-z0-9]{8}$'),
  created_at timestamptz not null default now()
);
create table if not exists referrals (
  referee_id  uuid primary key references auth.users(id) on delete cascade,      -- a person can be referred once, ever
  referrer_id uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  rewarded_at timestamptz,
  check (referee_id <> referrer_id)
);
create index if not exists referrals_referrer_idx on referrals(referrer_id);
-- Days owed to people whose plan is paid (we never touch a Stripe-managed subscription row). Apply them as a Stripe coupon/credit.
create table if not exists referral_banked_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  days int not null check (days > 0), created_at timestamptz not null default now(), applied_at timestamptz
);
alter table referral_codes enable row level security; alter table referrals enable row level security; alter table referral_banked_days enable row level security;
revoke all on referral_codes, referrals, referral_banked_days from anon, authenticated;
grant select on referral_codes, referrals to authenticated;
drop policy if exists referral_codes_own on referral_codes; create policy referral_codes_own on referral_codes for select to authenticated using (user_id = auth.uid());
drop policy if exists referrals_own on referrals; create policy referrals_own on referrals for select to authenticated using (referrer_id = auth.uid());

create or replace function _rand_code() returns text language sql volatile as $$
  select string_agg(substr('abcdefghjkmnpqrstuvwxyz23456789', 1 + floor(random() * 31)::int, 1), '') from generate_series(1, 8) $$;

create or replace function get_or_create_referral_code() returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c text; tries int := 0;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select code into c from referral_codes where user_id = uid; if c is not null then return c; end if;
  loop
    tries := tries + 1; c := _rand_code();
    begin insert into referral_codes(user_id, code) values (uid, c); return c;
    exception when unique_violation then
      select code into c from referral_codes where user_id = uid; if c is not null then return c; end if;
      if tries > 10 then raise exception 'code_generation_failed'; end if;
    end;
  end loop;
end $$;

-- Called by the signed-in NEW user, once, within 7 days of creating the account. Returns a status string; never reveals who owns a code.
create or replace function apply_referral(p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); ref uuid; created timestamptz;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select created_at into created from auth.users where id = uid;
  if created is null or created < now() - interval '7 days' then return 'too_late'; end if;
  select user_id into ref from referral_codes where code = lower(btrim(p_code));
  if ref is null then return 'invalid'; end if;
  if ref = uid then return 'invalid'; end if;
  begin insert into referrals(referee_id, referrer_id) values (uid, ref);
  exception when unique_violation then return 'already_applied'; end;
  return 'applied';
end $$;

-- Server-only (service role), called after the referee's 5th saved link. Idempotent; at most 12 rewarded referrals per referrer.
create or replace function reward_referral(p_referee uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r referrals%rowtype; n int; granted jsonb := '[]'::jsonb; who uuid;
begin
  select * into r from referrals where referee_id = p_referee for update;
  if r.referee_id is null then return jsonb_build_object('status', 'no_referral'); end if;
  if r.rewarded_at is not null then return jsonb_build_object('status', 'already_rewarded'); end if;
  if (select count(*) from oneclist_items where user_id = p_referee) < 5 then return jsonb_build_object('status', 'not_active_yet'); end if;
  select count(*) into n from referrals where referrer_id = r.referrer_id and rewarded_at is not null;
  update referrals set rewarded_at = now() where referee_id = p_referee;
  foreach who in array array[p_referee] || case when n < 12 then array[r.referrer_id] else array[]::uuid[] end loop
    declare s user_subscriptions%rowtype;
    begin
      select * into s from user_subscriptions where user_id = who for update;
      if s.user_id is null or effective_plan(who) = 'free' then
        insert into user_subscriptions(user_id, plan, status, current_period_end) values (who, 'pro', 'trialing', now() + interval '30 days')
        on conflict (user_id) do update set plan = 'pro', status = 'trialing', current_period_end = now() + interval '30 days';
        granted := granted || jsonb_build_object('user', who, 'kind', 'trial');
      elsif s.status = 'trialing' and s.monthly_price_usd is null then
        update user_subscriptions set current_period_end = greatest(coalesce(current_period_end, now()), now()) + interval '30 days' where user_id = who;
        granted := granted || jsonb_build_object('user', who, 'kind', 'extended');
      else
        insert into referral_banked_days(user_id, days) values (who, 30);
        granted := granted || jsonb_build_object('user', who, 'kind', 'banked');
      end if;
    end;
  end loop;
  return jsonb_build_object('status', 'rewarded', 'granted', granted, 'referrer_capped', n >= 12);
end $$;

revoke all on function _rand_code(), get_or_create_referral_code(), apply_referral(text), reward_referral(uuid) from public, anon, authenticated;
grant execute on function get_or_create_referral_code(), apply_referral(text) to authenticated;     -- reward_referral: service role only
grant execute on function reward_referral(uuid), get_or_create_referral_code(), apply_referral(text) to service_role;
