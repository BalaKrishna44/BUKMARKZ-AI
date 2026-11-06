-- Friday Vault After-Hours (029). Runs after growth.test.sql in the same database; uses its helpers (_as, _svc, _back, ok, throws).
do $$
declare a uuid := '00000000-0000-0000-0000-00000000f0a1'; b uuid := '00000000-0000-0000-0000-00000000f0b1'; c uuid := '00000000-0000-0000-0000-00000000f0c1';
  fri_ist timestamptz := '2026-10-30 10:30:00+00';   -- Friday 16:00 in Asia/Calcutta, Friday 03:30 in Los Angeles
  t jsonb := '[{"who":"markz","text":"hi"},{"who":"buk","text":"no"}]';
begin
  insert into auth.users(id, email) values (a, 'fa@x.test'), (b, 'fb@x.test'), (c, 'fc@x.test');
  perform _as(a); perform set_friday_enabled(true, 'Asia/Calcutta');
  perform ok((select enabled and tz = 'Asia/Kolkata' from friday_prefs where user_id = a), 'friday: user opts in; the retired name Asia/Calcutta is stored as Asia/Kolkata');
  perform set_friday_enabled(true, 'Not/AZone');
  perform ok((select tz from friday_prefs where user_id = a) = 'UTC', 'friday: unknown time zone falls back to UTC');
  perform set_friday_enabled(true, 'EST5EDT; drop table x');
  perform ok((select tz from friday_prefs where user_id = a) = 'UTC', 'friday: junk input falls back to UTC');
  perform ok((select tz from friday_prefs where user_id = a) = 'UTC', 'friday: unknown time zone falls back to UTC');
  perform set_friday_enabled(true, 'Asia/Calcutta');
  perform _as(b); perform set_friday_enabled(true, 'America/Los_Angeles');
  perform _as(c); perform set_friday_enabled(false, 'Asia/Calcutta');
  perform throws($q$select claim_friday_users(5)$q$, 'friday: users cannot claim');
  perform throws($q$select friday_referral_code('00000000-0000-0000-0000-00000000f0a1')$q$, 'friday: users cannot mint referral codes');
  perform throws($q$select * from friday_jokes$q$, 'friday: users cannot read the jokes table');
  perform throws($q$select friday_store_joke('2026-W44', '[]', 'ai')$q$, 'friday: users cannot store jokes');
  perform _as(null); perform throws($q$select set_friday_enabled(true, 'UTC')$q$, 'friday: anon cannot opt in');

  perform _svc();
  perform ok((select array_agg(user_id) from claim_friday_users(10, fri_ist)) = array[a], 'friday: only the user whose LOCAL clock says Friday 16:00 is claimed (not LA, not opted-out)');
  perform ok((select count(*) from claim_friday_users(10, fri_ist)) = 0, 'friday: a second firing in the same hour claims nobody');
  perform ok((select count(*) from claim_friday_users(10, fri_ist + interval '1 hour')) = 0, 'friday: still nobody the next hour (already mailed)');
  perform friday_release(a);
  perform ok((select count(*) from claim_friday_users(10, fri_ist + interval '1 hour')) = 1, 'friday: failed send is retried in the 17:00 hour');
  perform friday_release(a);
  perform ok((select count(*) from claim_friday_users(10, fri_ist + interval '2 hours')) = 0, 'friday: no send at 18:00 local');
  perform ok((select count(*) from claim_friday_users(10, fri_ist - interval '1 day')) = 0, 'friday: no send on Thursday');
  perform ok((select count(*) from claim_friday_users(10, fri_ist + interval '1 day')) = 0, 'friday: no send on Saturday');
  perform ok((select array_agg(user_id) from claim_friday_users(10, '2026-10-30 23:30:00+00')) = array[b], 'friday: Los Angeles gets it at their own 16:30 (Friday 23:30 UTC)');
  perform ok((select count(*) from claim_friday_users(10, fri_ist + interval '7 days')) = 1, 'friday: next Friday claims again');

  perform ok(friday_week_saves(a) = 0, 'friday: week saves is a plain count');
  perform ok(friday_referral_code(a) ~ '^[a-z0-9]{8}$' and friday_referral_code(a) = friday_referral_code(a), 'friday: referral code is created once and reused');
  perform ok((select status from friday_store_joke('2026-W44', t, 'ai')) = 'ready', 'friday: joke stored');
  perform ok((select source from friday_store_joke('2026-W44', '[{"who":"buk","text":"other"},{"who":"markz","text":"x"}]', 'pool')) = 'ai', 'friday: first stored joke wins a race');
  perform _back(); update friday_jokes set status = 'blocked' where week_key = '2026-W44'; perform _svc();
  perform ok((select status from friday_store_joke('2026-W44', t, 'ai')) = 'blocked' and (select status from friday_get_joke('2026-W44')) = 'blocked', 'friday: a blocked joke stays blocked');
  perform throws($q$select friday_store_joke('week 44', '[{"a":1},{"a":2}]', 'ai')$q$, 'friday: bad week key rejected');
  perform throws($q$select friday_store_joke('2026-W45', '[{"a":1}]', 'ai')$q$, 'friday: a one-line joke is rejected');
  perform throws($q$select friday_store_joke('2026-W45', '[{"a":1},{"a":2}]', 'llm')$q$, 'friday: unknown source rejected');
  perform _back();
  raise notice 'ALL FRIDAY SQL CHECKS PASSED';
end $$;
