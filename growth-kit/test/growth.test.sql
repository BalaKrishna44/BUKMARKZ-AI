-- Plain-SQL assertions (no pgTAP needed). Each check raises on failure; the runner prints one line per check.
create or replace function _as(sub uuid) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub', coalesce(sub::text, ''), true);
  perform set_config('role', case when sub is null then 'anon' else 'authenticated' end, true); end $$;
create or replace function _svc() returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub', '', true); perform set_config('role', 'service_role', true); end $$;
create or replace function _back() returns void language plpgsql as $$ begin perform set_config('role', 'postgres', true); perform set_config('request.jwt.claim.sub', '', true); end $$;
create or replace function ok(c boolean, n text) returns void language plpgsql as $$ begin
  if c is not true then raise exception 'FAIL: %', n; end if; raise notice 'ok - %', n; end $$;
create or replace function throws(q text, n text) returns void language plpgsql as $$ begin
  begin execute q; exception when others then raise notice 'ok - % (%)', n, sqlerrm; return; end; raise exception 'FAIL: % did not raise', n; end $$;
grant execute on function _as(uuid), _svc(), _back(), ok(boolean, text), throws(text, text) to public;

do $$ declare a uuid := '00000000-0000-0000-0000-00000000000a'; b uuid := '00000000-0000-0000-0000-00000000000b'; c uuid := '00000000-0000-0000-0000-00000000000c'; code text; r jsonb; st text; i int;
begin
  insert into auth.users(id) values (a), (b), (c);
  update auth.users set created_at = now() where id in (a, b, c);

  -- ===== onboarding =====
  perform _as(a);
  r := onboarding_state(); perform ok((r->>'items')::int = 0 and (r->>'dismissed')::boolean = false, 'onboarding: fresh user has 0 items, not dismissed');
  perform onboarding_mark('ask'); perform onboarding_mark('ask');
  perform ok((onboarding_state()->>'asked')::boolean, 'onboarding: ask is recorded (idempotent)');
  perform throws($q$select onboarding_mark('hack')$q$, 'onboarding: unknown step rejected');
  perform _as(null);
  perform throws($q$select onboarding_state()$q$, 'onboarding: anon cannot call state (no execute grant)');
  perform _back();
  insert into stacks(user_id, slug, title, is_starter) values (b, 'starter-pg', 'Postgres starter', true), (b, 'not-starter', 'Mine', false);
  insert into creator_profiles(user_id, handle) values (b, 'bukmarkz');
  insert into stack_items(stack_id, position, title, url) select id, 0, 'Docs', 'https://www.postgresql.org/docs/' from stacks where slug = 'starter-pg';
  perform _as(a);
  perform ok(jsonb_array_length(list_starter_stacks()) = 1 and list_starter_stacks()->0->>'slug' = 'starter-pg', 'onboarding: only starter stacks listed');
  perform throws($q$update stacks set is_starter = true where slug = 'not-starter'$q$, 'onboarding: users cannot flag a stack as starter');
  perform _back();

  -- ===== referrals =====
  perform _as(b); code := get_or_create_referral_code(); perform ok(code ~ '^[a-z0-9]{8}$' and get_or_create_referral_code() = code, 'referral: code is stable per user');
  perform _as(b); perform ok(apply_referral(code) = 'invalid', 'referral: cannot refer yourself');
  perform _as(a); perform ok(apply_referral('zzzzzzzz') = 'invalid', 'referral: unknown code is invalid');
  perform ok(apply_referral(upper(code)) = 'applied', 'referral: valid code applies (case-insensitive)');
  perform ok(apply_referral(code) = 'already_applied', 'referral: only once');
  perform _back(); update auth.users set created_at = now() - interval '9 days' where id = c;
  perform _as(c); perform ok(apply_referral(code) = 'too_late', 'referral: old accounts cannot be referred');
  perform _as(a); perform throws($q$select reward_referral('00000000-0000-0000-0000-00000000000a')$q$, 'referral: reward is not callable by users');
  perform _svc(); r := reward_referral(a); perform ok(r->>'status' = 'not_active_yet', 'referral: no reward before 5 saved links');
  perform _back();
  insert into oneclist_items(user_id, url, url_key, title) select a, 'https://e.com/' || g, 'e.com/' || g, 't' from generate_series(1, 5) g;
  perform _svc(); r := reward_referral(a);
  perform ok(r->>'status' = 'rewarded' and jsonb_array_length(r->'granted') = 2, 'referral: both people rewarded after 5 links');
  perform _back();
  perform ok(effective_plan(a) = 'pro' and effective_plan(b) = 'pro', 'referral: both are Pro now');
  perform ok((select current_period_end from user_subscriptions where user_id = a) between now() + interval '29 days' and now() + interval '31 days', 'referral: 30 days');
  perform _svc(); r := reward_referral(a); perform ok(r->>'status' = 'already_rewarded', 'referral: reward is idempotent');
  perform _back();
  -- paid people are never overwritten: bank the days instead
  insert into user_subscriptions(user_id, plan, status, current_period_end, monthly_price_usd) values (c, 'pro', 'active', now() + interval '20 days', 4.99);
  update auth.users set created_at = now() where id = c;
  perform _as(c); perform ok(apply_referral(code) = 'applied', 'referral: second referee applies');
  perform _back();
  insert into oneclist_items(user_id, url, url_key, title) select c, 'https://e.com/c' || g, 'e.com/c' || g, 't' from generate_series(1, 5) g;
  perform _svc(); r := reward_referral(c); perform _back();
  perform ok((select count(*) from referral_banked_days where user_id = c) = 1, 'referral: paying user gets banked days');
  perform ok((select current_period_end from user_subscriptions where user_id = c) < now() + interval '21 days', 'referral: paid subscription row untouched');
  perform _as(a); perform ok((select count(*) from referrals) = 0, 'referral: referee cannot see referrals table rows of others');
  perform _as(b); perform ok((select count(*) from referrals) = 2, 'referral: referrer sees own referrals');
  perform _back();

  -- ===== digest =====
  perform _as(a); perform set_digest_enabled(true); perform _back();
  perform _as(b); perform ok((select count(*) from digest_prefs) = 0, 'digest: users see only their own prefs');
  perform _back();
  update oneclist_items set created_at = now() - interval '30 days' where user_id = a;
  update oneclist_items set is_private = true where user_id = a and url like '%/1';
  perform _svc();
  perform ok((select count(*) from claim_digest_users(10)) = 1, 'digest: due user is claimed');
  perform ok((select count(*) from claim_digest_users(10)) = 0, 'digest: second cron firing claims nothing');
  perform ok(not exists (select 1 from digest_pick_items(a, '{}', 10) where url like '%/1'), 'digest: private links never picked');
  perform ok((select count(*) from digest_pick_items(a, '{}', 10)) = 4, 'digest: 4 eligible links');
  perform ok((select count(*) from digest_pick_items(a, (select array_agg(id) from (select id from digest_pick_items(a, '{}', 2)) x), 10)) = 2, 'digest: excludes links shown last time');
  -- v2: unread-only, not shelved, 14+ days, stable within a week, 5 max, summary returned
  perform _back();
  update oneclist_items set last_opened_at = now() where user_id = a and url like '%/2';
  update oneclist_items set shelved_at = now() where user_id = a and url like '%/3';
  update oneclist_items set summary = 'Short recap. Second sentence.' where user_id = a and url like '%/4';
  perform _svc();
  perform ok((select count(*) from digest_pick_items(a, '{}', 10)) = 2, 'digest v2: opened and shelved links are never picked');
  perform ok((select summary from digest_pick_items(a, '{}', 10) where url like '%/4') = 'Short recap. Second sentence.', 'digest v2: summary is returned');
  perform ok((select array_agg(id order by id) from digest_pick_items(a, '{}', 10)) = (select array_agg(id order by id) from digest_pick_items(a, '{}', 10)), 'digest v2: same picks on a retry in the same week');
  perform ok((select count(*) from digest_pick_items(a, '{}', 1)) = 1, 'digest v2: limit respected');
  perform _back();
  update oneclist_items set last_opened_at = null, shelved_at = null where user_id = a;
  update oneclist_items set created_at = now() - interval '3 days' where user_id = a and url like '%/4';
  perform _svc();
  perform ok(not exists (select 1 from digest_pick_items(a, '{}', 10) where url like '%/4'), 'digest v2: links younger than 14 days are never picked');
  perform digest_release(a);
  perform ok((select count(*) from claim_digest_users(10)) = 1, 'digest: failed send is retried after release');
  perform _as(a); perform throws($q$select claim_digest_users(5)$q$, 'digest: users cannot claim');
  perform _back();
  raise notice 'ALL GROWTH SQL CHECKS PASSED';
end $$;
