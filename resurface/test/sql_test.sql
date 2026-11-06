\set ON_ERROR_STOP on
create or replace function ok(c boolean, m text) returns void language plpgsql as $$ begin if not c then raise exception 'FAIL: %', m; end if; raise notice 'ok   %', m; end $$;
set client_min_messages = notice;
\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set C '00000000-0000-0000-0000-00000000000c'
\set D '00000000-0000-0000-0000-00000000000d'
\set E '00000000-0000-0000-0000-00000000000e'
insert into auth.users select x from (values (:'A'::uuid),(:'B'),(:'C'),(:'D'),(:'E')) t(x);

-- helper: insert an item N days ago
create or replace function put(u uuid, n text, url text, days int, emb real[], model text default 'm1', opened_days int default null, shelved boolean default false, st text default 'bookmark') returns uuid language plpgsql as $$
declare i uuid := gen_random_uuid(); begin
  insert into oneclist_items(id, user_id, url, url_key, title, created_at, embedding, embedding_model, last_opened_at, shelved_at, status)
  values (i, u, url, url || '#' || n, n, now() - make_interval(days => days), emb, model, case when opened_days is not null then now() - make_interval(days => opened_days) end, case when shelved then now() end, st);
  return i; end $$;

-- ---- user A: six saves this week around [1,0,0], then a mixed shelf of older links
do $$ declare u uuid := '00000000-0000-0000-0000-00000000000a'::uuid; i int; begin
  for i in 1..6 loop perform put(u, 'recent'||i, 'https://r'||i||'.com/p', 1, array[1, 0.05*i, 0]::real[]); end loop;
  perform put(u, 'o1', 'https://d1.com/1', 30, array[0.9,0.1,0]::real[]);
  perform put(u, 'o2', 'https://d1.com/2', 31, array[0.9,0.1,0]::real[]);
  perform put(u, 'o3', 'https://www.d1.com/3', 32, array[0.9,0.1,0]::real[]);          -- third link of d1.com: must be dropped by the domain cap
  perform put(u, 'o4', 'https://d2.com/x', 100, array[0.9,0.1,0]::real[], 'm1', 100);  -- opened, but long ago
  perform put(u, 'o5', 'https://d3.com/x', 30, array[0,1,0]::real[]);                  -- unrelated topic
  perform put(u, 'o6', 'https://d5.com/x', 30, array[0.9,0.1,0]::real[], 'm1', 5);     -- opened 5 days ago: leave it alone
  perform put(u, 'o7', 'https://d6.com/x', 30, array[0.9,0.1,0]::real[], 'm1', null, true);   -- archived
  perform put(u, 'o8', 'https://d4.com/x', 30, null);                                  -- no embedding yet
  perform put(u, 'o9', 'https://d7.com/x', 30, array[0.9,0.1,0]::real[], 'm2');        -- different embedding model: not comparable
  perform put(u, 'o10', 'bukmarkz://scan/1', 30, array[0.9,0.1,0]::real[]);            -- a scan, not a link
  perform put(u, 'o11', 'https://d8.com/x', 30, array[0.9,0.1,0]::real[], 'm1', null, false, 'actionable_task');
end $$;

select ok((select count(*) from resurface_pending_users(10)) >= 1 and exists (select 1 from resurface_pending_users(10) where user_id = :'A'), 'active user is pending before the nightly run');
select generate_daily_resurface(:'A') as rid \gset
select ok((select status from daily_resurface where id = :'rid') = 'ready' and (select cardinality(item_ids) from daily_resurface where id = :'rid') = 5, 'ready batch with exactly 5 picks');
create temp table names as select n.title, o.ord from daily_resurface d, unnest(d.item_ids) with ordinality o(id, ord) join oneclist_items n on n.id = o.id where d.id = :'rid';
select ok(not exists (select 1 from names where title ~ '^recent'), 'last week''s saves are never resurfaced (they are the profile, not the candidates)');
select ok(exists (select 1 from names where title = 'o2') and exists (select 1 from names where title = 'o4') and exists (select 1 from names where title in ('o1','o3')), 'similar, unread and long-untouched items are picked');
select ok((select count(*) from names where title in ('o1','o2','o3')) = 2, 'at most 2 links per domain (d1.com and www.d1.com count together)');
select ok(not exists (select 1 from names where title in ('o5')), 'unrelated item ranks below the five better candidates');
select ok(not exists (select 1 from names where title in ('o6','o7','o10','o11')), 'recently opened, archived, scans and to-dos are excluded');
select ok((select title from names where ord = 1) in ('o1','o2','o3') and (select title from names where ord in (4,5) group by title having count(*)=1 order by title limit 1) is not null and exists (select 1 from names where ord >= 4 and title in ('o8','o9')), 'ranked: similar+unread first; items without a comparable vector get a neutral score and rank below them');
select ok((select (picks->0->>'unread')::boolean from daily_resurface where id = :'rid') and (select (picks->0->>'sim')::float from daily_resurface where id = :'rid') > 0.9, 'picks record why: unread + similarity');
select ok(generate_daily_resurface(:'A') = :'rid' and (select count(*) from daily_resurface where user_id = :'A') = 1, 'idempotent per day: same id, one row');
select ok(not exists (select 1 from resurface_pending_users(100) where user_id = :'A'), 'user with a batch leaves the pending list');
-- next day: five were just resurfaced, only o3/o5 remain -> below the minimum -> recorded as empty, not padded with weak picks
select generate_daily_resurface(:'A', (now() at time zone 'utc')::date + 1) as rid2 \gset
select ok((select status from daily_resurface where id = :'rid2') = 'empty' and (select quiz_status from daily_resurface where id = :'rid2') = 'none', 'next day: anti-repeat leaves too few -> empty batch (no quiz, no retry)');
update daily_resurface set created_at = now() - interval '15 days' where id = :'rid';
select generate_daily_resurface(:'A', (now() at time zone 'utc')::date + 2) as rid3 \gset
select ok((select status from daily_resurface where id = :'rid3') = 'ready', 'after 14 days the same links become eligible again');

-- ---- user B: only brand-new saves -> nothing to resurface, but still recorded
do $$ begin perform put('00000000-0000-0000-0000-00000000000b'::uuid, 'b1', 'https://b1.com', 1, array[1,0,0]::real[]); perform put('00000000-0000-0000-0000-00000000000b'::uuid, 'b2', 'https://b2.com', 2, array[1,0,0]::real[]); end $$;
select ok(exists (select 1 from resurface_pending_users(100) where user_id = :'B'), 'new user is pending');
select ok((select status from daily_resurface where id = generate_daily_resurface(:'B')) = 'empty', 'only fresh saves -> empty batch');

-- ---- user C: inactive for 90 days -> never pending. user D: opted out -> never pending
do $$ begin perform put('00000000-0000-0000-0000-00000000000c'::uuid, 'c1', 'https://c1.com', 90, null); perform put('00000000-0000-0000-0000-00000000000d'::uuid, 'd1', 'https://d1x.com', 2, null);
  insert into resurface_prefs(user_id, enabled) values ('00000000-0000-0000-0000-00000000000d'::uuid, false); end $$;
select ok(not exists (select 1 from resurface_pending_users(100) where user_id in (:'C', :'D')), 'inactive (30+ days) and opted-out users are skipped');

-- ---- user E: no embeddings at all -> still works, ordered by staleness; limit respected
do $$ declare i int; begin for i in 1..12 loop perform put('00000000-0000-0000-0000-00000000000e'::uuid, 'e'||i, 'https://e'||i||'.com', 10 + i * 10, null); end loop; end $$;
select generate_daily_resurface(:'E') as rid4 \gset
select ok((select cardinality(item_ids) from daily_resurface where id = :'rid4') = 5, 'no embeddings: still 5 picks');
select ok((select string_agg(n.title, ',' order by o.ord) from daily_resurface d, unnest(d.item_ids) with ordinality o(id, ord) join oneclist_items n on n.id = o.id where d.id = :'rid4') = 'e12,e11,e10,e9,e8', 'no embeddings: oldest first (staleness decides)');
select ok(cardinality((select array_agg(x) from resurface_pending_users(2) x)) <= 2, 'pending list honours its limit');

-- ---- safety: who may call what
set role authenticated; select set_config('app.uid', :'A', false);
select ok((select count(*) from daily_resurface) >= 3 and not exists (select 1 from daily_resurface where user_id <> :'A'), 'a user sees only their own batches');
do $$ begin begin perform generate_daily_resurface(auth.uid(), current_date + 50); raise exception 'client can generate'; exception when insufficient_privilege then raise notice 'ok   clients cannot call the generator'; end; end $$;
do $$ begin begin perform * from resurface_pending_users(1); raise exception 'client can list users'; exception when insufficient_privilege then raise notice 'ok   clients cannot list pending users'; end; end $$;
do $$ begin begin update daily_resurface set quiz_answer = 'x'; raise exception 'client can edit'; exception when insufficient_privilege then raise notice 'ok   clients cannot edit batches'; end; end $$;
reset role; set role anon;
do $$ begin begin perform 1 from daily_resurface; raise exception 'anon read'; exception when insufficient_privilege then raise notice 'ok   anon has no access'; end; end $$;
reset role;
select ok(true, 'DONE');
