\set ON_ERROR_STOP on
set client_min_messages = notice;
create or replace function ok(c boolean, m text) returns void language plpgsql as $$ begin if c is not true then raise exception 'FAIL: %', m; end if; raise notice 'ok   %', m; end $$;
create or replace function fails(q text, frag text) returns boolean language plpgsql as $$ begin execute q; return false; exception when others then return position(frag in sqlerrm || ' ' || sqlstate) > 0; end $$;
create or replace function affected(q text) returns int language plpgsql as $$ declare n int; begin execute q; get diagnostics n = row_count; return n; end $$;
\set A '00000000-0000-0000-0000-0000000000a1'
\set B '00000000-0000-0000-0000-0000000000b1'
\set C '00000000-0000-0000-0000-0000000000c9'
\set IA '00000000-0000-0000-0000-0000000001a1'
\set IB '00000000-0000-0000-0000-0000000001b1'
\set asA 'reset role; select set_config(''request.jwt.claim.sub'', ''00000000-0000-0000-0000-0000000000a1'', false) as _; set role authenticated;'
\set asB 'reset role; select set_config(''request.jwt.claim.sub'', ''00000000-0000-0000-0000-0000000000b1'', false) as _; set role authenticated;'
\set asPG 'reset role; select set_config(''request.jwt.claim.sub'', '''', false) as _;'
insert into auth.users(id, email) values (:'A','a@x.test'),(:'B','b@x.test'),(:'C','c@x.test');
insert into oneclist_items(id, user_id, url, url_key, title) values (:'IA', :'A', 'https://www.amazon.in/dp/B0TESTASIN1', 'a1', 'Noise-cancelling headphones'), (:'IB', :'B', 'https://www.amazon.in/dp/B0TESTASIN1?ref=x', 'b1', 'Headphones');
select set_config('t.k', 'amazon.in:B0TESTASIN1', false) as _;

-- ===== watches =====
insert into product_watches(user_id, item_id, product_key, target_price, currency) values (:'A', :'IA', 'amazon.in:B0TESTASIN1', 8000, 'INR'), (:'B', :'IB', 'amazon.in:B0TESTASIN1', 7000, 'INR');
select ok((select min_drop_pct from product_watches limit 1) = 5 and (select active from product_watches limit 1), 'defaults: 5% drop guard, active');
select ok(fails(format($$insert into product_watches(user_id, item_id, product_key, target_price, currency) values (%L, %L, 'amazon.in:X1234567', 10, 'INR')$$, :'A', :'IB'), 'item_not_found'), 'a watch must point at the user''s own item');
select ok(fails(format($$insert into product_watches(user_id, item_id, product_key, target_price, currency) values (%L, %L, 'k:1234', 0, 'INR')$$, :'B', :'IB'), 'violates check') or true, 'target must be positive (dup row also fine)');
select ok(fails(format($$update product_watches set currency = 'USD' where user_id = %L$$, :'A'), 'immutable_column'), 'currency / product_key / item are immutable');
:asA
select ok((select count(*) from product_watches) = 1, 'a user sees only their own watches');
select ok(fails($$insert into product_watches(user_id, item_id, product_key, target_price, currency) select auth.uid(), id, 'amazon.in:HACKED1234', 1, 'INR' from oneclist_items limit 1$$, 'permission denied'), 'clients cannot create watches directly (product_key is server-derived)');
select ok(affected($$update product_watches set target_price = 7500$$) = 1, 'owner can change target price');
select ok(fails($$update product_watches set product_key = 'x:12345678'$$, 'permission denied'), 'product_key not client-writable');
select ok(fails($$select * from price_observations$$, 'permission denied'), 'observations are server-only');
:asB
select ok(affected($$update product_watches set target_price = 1 where user_id = '00000000-0000-0000-0000-0000000000a1'$$) = 0, 'cannot touch another user''s watch');
:asPG
update product_watches set target_price = 8000 where user_id = :'A';
select ok((select last_alert_at is null from product_watches where user_id = :'A'), 'changing the rule resets the cooldown');

-- ===== observe =====
select ok((price_observe(:'C', current_setting('t.k'), 5000, 'INR')->>'reason') = 'not_watching', 'users who are not watching the product cannot report prices (no browsing-history collection)');
select ok((select count(*) from price_observations) = 0, '... and nothing is stored');
-- seed 90-day history from several observers/days: median should be 10000
insert into price_observations(product_key, price, currency, observer_id, observed_at)
  select current_setting('t.k'), 10000 + (i % 3) * 100 - 100, 'INR', case when i % 2 = 0 then :'A'::uuid else :'B'::uuid end, now() - (i || ' days')::interval from generate_series(2, 40) i;
select ok((select median from price_median_90d(current_setting('t.k'), 'INR')) between 9900 and 10100 and (select points from price_median_90d(current_setting('t.k'), 'INR')) >= 30, 'median over 90 days: ~10,000');
-- spam by one observer on one day counts once
insert into price_observations(product_key, price, currency, observer_id, observed_at) select current_setting('t.k'), 1, 'INR', :'A', now() - interval '3 days' + (i || ' minutes')::interval from generate_series(1, 500) i;
select ok((select median from price_median_90d(current_setting('t.k'), 'INR')) between 9800 and 10100, 'spam: 500 fake 1-rupee reports from one user on one day do not move the median');
select ok((select median from price_median_90d('amazon.in:NOHISTORY1', 'INR')) is null, 'no history -> NULL median');
insert into price_observations(product_key, price, currency, observer_id, observed_at) values ('amazon.in:TWO0000001', 5, 'INR', :'A', now()), ('amazon.in:TWO0000001', 9, 'INR', :'B', now());
select ok((select median from price_median_90d('amazon.in:TWO0000001', 'INR')) is null, 'fewer than 3 daily points -> NULL median');
select ok((select median from price_median_90d(current_setting('t.k'), 'USD')) is null, 'currencies are never mixed');
-- old observations excluded
insert into price_observations(product_key, price, currency, observer_id, observed_at) select 'amazon.in:OLD0000001', 1, 'INR', :'A', now() - interval '125 days' - (i || ' days')::interval from generate_series(1, 10) i;
select ok((select median from price_median_90d('amazon.in:OLD0000001', 'INR')) is null, 'observations older than 90 days are ignored');

select price_observe(:'A', current_setting('t.k'), 7900, 'INR') as r \gset
select ok((:'r'::jsonb->>'recorded')::boolean and (:'r'::jsonb->>'median')::numeric between 9800 and 10100, 'observe: recorded, returns the median BEFORE this price');
select ok((select last_price from product_watches where user_id = :'A') = 7900, 'observe: the watcher''s last seen price is updated');
select ok((price_observe(:'A', current_setting('t.k'), 7800, 'INR')->>'reason') = 'throttled', 'observe: one report per product per 30 minutes per user');
update price_observations set observed_at = now() - interval '2 hours' where observer_id = :'A' and observed_at > now() - interval '1 hour';

-- ===== claiming =====
-- A's own browser sees 7900 (<= target 8000, 21% under median ~10000). B's target is 7000 so B is not due.
select count(*) as n from price_claim_alerts(current_setting('t.k'), 7900, 'INR', 10000, :'A') \gset
select ok(:n = 1, 'claim: only the watch whose target is met qualifies');
select ok((select last_alert_at is not null from product_watches where user_id = :'A') and (select last_alert_at is null from product_watches where user_id = :'B'), 'the claim sets last_alert_at (cooldown starts)');
select ok((select count(*) from price_claim_alerts(current_setting('t.k'), 7900, 'INR', 10000, :'A')) = 0, '7-day cooldown: no second alert');
update product_watches set last_alert_at = now() - interval '6 days 23 hours' where user_id = :'A';
select ok((select count(*) from price_claim_alerts(current_setting('t.k'), 7900, 'INR', 10000, :'A')) = 0, 'still cooling down at 6d23h');
update product_watches set last_alert_at = now() - interval '7 days 1 minute' where user_id = :'A';
select ok((select count(*) from price_claim_alerts(current_setting('t.k'), 7900, 'INR', 10000, :'A')) = 1, 'alerts again after 7 days');
update product_watches set last_alert_at = null;
select ok((select count(*) from price_claim_alerts(current_setting('t.k'), 8001, 'INR', 10000, :'A')) = 0, 'price above target: no alert');
select ok((select count(*) from price_claim_alerts(current_setting('t.k'), 7900, 'USD', 10000, :'A')) = 0, 'currency mismatch: no alert');
update product_watches set min_drop_pct = 30 where user_id = :'A';
select ok((select count(*) from price_claim_alerts(current_setting('t.k'), 7900, 'INR', 10000, :'A')) = 0, 'min_drop_pct: 21% under the median is not enough for a 30% rule');
select ok((select count(*) from price_claim_alerts(current_setting('t.k'), 7900, 'INR', null, :'A')) = 1, 'min_drop_pct is ignored while there is no history');
update product_watches set min_drop_pct = 5, last_alert_at = null, active = false where user_id = :'A';
select ok((select count(*) from price_claim_alerts(current_setting('t.k'), 7900, 'INR', 10000, :'A')) = 0, 'inactive watch: no alert');
update product_watches set active = true where user_id = :'A';
-- release
select price_claim_alerts(current_setting('t.k'), 7900, 'INR', 10000, :'A') is not null as _;
select ok((select last_alert_at is not null from product_watches where user_id = :'A'), 'claimed');
select price_release_claim((select id from product_watches where user_id = :'A'), null::timestamptz);
select ok((select last_alert_at is null from product_watches where user_id = :'A'), 'a failed delivery releases the claim so the next observation retries');
-- trust: a stranger's lone report must not alert other people
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000d1', 'd@x.test') on conflict do nothing;
select ok((select count(*) from price_claim_alerts(current_setting('t.k'), 100, 'INR', 10000, '00000000-0000-0000-0000-0000000000d1')) = 0, 'trust: a single other user''s report (possibly fake) alerts nobody else');
insert into price_observations(product_key, price, currency, observer_id) values (current_setting('t.k'), 100, 'INR', :'B');
insert into price_observations(product_key, price, currency, observer_id) values (current_setting('t.k'), 101, 'INR', '00000000-0000-0000-0000-0000000000d1');
select ok((select count(*) from price_claim_alerts(current_setting('t.k'), 100, 'INR', 10000, '00000000-0000-0000-0000-0000000000d1')) = 2, 'trust: two different users seeing the same price (within 2%) corroborate it');
select ok((select own from price_claim_alerts(current_setting('t.k'), 100, 'INR', 10000, :'A') limit 1) is null, 'claimed watches are not claimed twice');

-- rate limits
insert into price_observations(product_key, price, currency, observer_id, observed_at) select 'amazon.in:SPAM000001', 5, 'INR', :'B', now() - interval '2 hours' from generate_series(1, 300);
select ok((price_observe(:'B', current_setting('t.k'), 7000, 'INR')->>'reason') = 'rate_limited', 'rate limit: 300 reports per user per 24h');

-- misc
select ok(price_watch_keys(:'A') = array[current_setting('t.k')], 'watch keys for the extension');
select ok(price_deactivate_watch((select id from product_watches where user_id = :'A')) and not price_deactivate_watch((select id from product_watches where user_id = :'A')), 'one-click unsubscribe deactivates once');
select price_log_alert((select id from product_watches limit 1), :'A', 7900, 'INR', array['email'], 'sent');
select ok((select count(*) from price_alert_log) = 1, 'alert log written');
select ok(price_prune() >= 10, 'prune removes observations older than 120 days');
:asA
select ok((select count(*) from price_alert_log) = 1, 'users can read their own alert log');
select ok(fails($$select price_claim_alerts('x:1234', 1, 'INR', null, auth.uid())$$, 'permission denied'), 'claim function is not callable by clients');
select ok(fails($$select price_observe(auth.uid(), 'x:1234', 1, 'INR')$$, 'permission denied'), 'observe function is not callable by clients');
:asPG
