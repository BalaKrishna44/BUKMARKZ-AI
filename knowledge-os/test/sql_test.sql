\set ON_ERROR_STOP on
\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
create or replace function ok(c boolean, m text) returns void language plpgsql as $$ begin if not c then raise exception 'FAIL: %', m; end if; raise notice 'ok   %', m; end $$;
set client_min_messages = notice;

-- ---------- knowledge graph ----------
-- user A: cluster X = 3 near-identical vectors, cluster Y = 2, plus an outlier. user B has a vector equal to X's (must never link to A).
insert into oneclist_items(id,user_id,title,embedding,embedding_model) values
 ('10000000-0000-0000-0000-000000000001',:'A','x1','{1,0.05,0}','m1'),
 ('10000000-0000-0000-0000-000000000002',:'A','x2','{1,0.10,0}','m1'),
 ('10000000-0000-0000-0000-000000000003',:'A','x3','{1,0.00,0.05}','m1'),
 ('20000000-0000-0000-0000-000000000001',:'A','y1','{0,1,0.05}','m1'),
 ('20000000-0000-0000-0000-000000000002',:'A','y2','{0.05,1,0}','m1'),
 ('30000000-0000-0000-0000-000000000001',:'A','outlier','{0.5,0.5,0.9}','m1'),
 ('40000000-0000-0000-0000-000000000001',:'A','x-other-model','{1,0.05,0}','m2'),
 ('50000000-0000-0000-0000-000000000001',:'B','b-copy-of-x','{1,0.05,0}','m1'),
 ('60000000-0000-0000-0000-000000000001',:'A','no-embedding',null,null);

select ok(rebuild_item_edges(:'A', 0.95, 8) = 4, 'full rebuild at 0.95 writes 3 X pairs + 1 Y pair') ;
select ok((select count(*) from item_edges where user_id = :'A') = 4, 'edge count');
select ok((select bool_and(source_item_id < target_item_id) from item_edges), 'edges stored once, canonical order');
select ok((select count(*) from item_edges where user_id = :'B') = 0, 'user B has no edges');
select ok(not exists (select 1 from item_edges e join oneclist_items i on i.id in (e.source_item_id, e.target_item_id) where i.user_id <> e.user_id), 'no cross-tenant edges');
select ok(not exists (select 1 from item_edges e join oneclist_items i on i.id in (e.source_item_id, e.target_item_id) where i.title in ('outlier','x-other-model','no-embedding')), 'outlier / other model / unembedded items excluded');
select ok((select min(similarity_score) from item_edges) >= 0.95, 'all scores >= threshold');
select ok(rebuild_item_edges(:'A', 0.95, 8) = 4 and (select count(*) from item_edges where user_id=:'A') = 4, 'idempotent re-run');

-- lower threshold links the outlier somewhere; raising it again must remove stale edges
select ok(rebuild_item_edges(:'A', 0.30, 8) > 4, 'lower threshold adds edges');
select rebuild_item_edges(:'A', 0.99, 8);
select ok((select count(*) from item_edges where user_id=:'A' and similarity_score < 0.99) = 0, 'raising threshold removes stale edges');

-- incremental: change x1 so it no longer resembles X, recompute only x1
update oneclist_items set embedding = '{0,0,1}' where id = '10000000-0000-0000-0000-000000000001';
select rebuild_item_edges(:'A', 0.95, 8, array['10000000-0000-0000-0000-000000000001']::uuid[]);
select ok(not exists (select 1 from item_edges where '10000000-0000-0000-0000-000000000001' in (source_item_id, target_item_id) and similarity_score >= 0.95), 'incremental rebuild dropped x1''s old edges');
select ok(exists (select 1 from item_edges where '10000000-0000-0000-0000-000000000002' in (source_item_id, target_item_id) and '10000000-0000-0000-0000-000000000003' in (source_item_id, target_item_id)), 'untouched x2-x3 edge survives incremental rebuild');

-- permissions
set role authenticated; set app.uid = '00000000-0000-0000-0000-00000000000a';
select ok((select count(*) from item_edges) >= 0, 'authenticated can read own edges');
select ok((select count(*) from item_edges where user_id = :'B') = 0, 'RLS hides other user''s edges');
do $$ begin begin perform rebuild_item_edges('00000000-0000-0000-0000-00000000000a'); raise exception 'FAIL: authenticated could call rebuild'; exception when insufficient_privilege then raise notice 'ok   authenticated cannot call rebuild_item_edges'; end; end $$;
do $$ begin begin insert into item_edges values ('00000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003',1); raise exception 'FAIL: client insert allowed'; exception when insufficient_privilege then raise notice 'ok   client cannot write edges'; end; end $$;
reset role;

-- ---------- feeds ----------
insert into feeds(user_id,url) select :'A', 'https://example.com/f' || g from generate_series(1,5) g;
insert into feeds(user_id,url,status) values (:'A','https://paused.example/f','paused');
insert into feeds(user_id,url,next_fetch_at) values (:'A','https://later.example/f', now() + interval '1 day');
select ok((select count(*) from claim_due_feeds(3, 300)) = 3, 'claim_due_feeds respects limit');
select ok((select count(*) from claim_due_feeds(10, 300)) = 2, 'second claim only gets the unleased remainder (no double fetch)');
select ok((select count(*) from claim_due_feeds(10, 300)) = 0, 'paused / future feeds are never claimed');
update feeds set leased_until = now() - interval '1 second';
select ok((select count(*) from claim_due_feeds(10, 300)) = 5, 'expired leases are claimable again');
insert into feed_entries(feed_id,user_id,guid,url) select id, user_id, 'g1', 'https://x/1' from feeds limit 1;
do $$ begin begin insert into feed_entries(feed_id,user_id,guid,url) select feed_id, user_id, 'g1', 'https://x/1' from feed_entries limit 1; raise exception 'FAIL: dup guid allowed'; exception when unique_violation then raise notice 'ok   (feed,guid) is unique -> entries dedupe'; end; end $$;

-- ---------- podcast ----------
insert into podcast_episodes(user_id,source_item_ids) values (:'A', array['10000000-0000-0000-0000-000000000002']::uuid[]), (:'A', array['10000000-0000-0000-0000-000000000003']::uuid[]);
select ok((select count(*) from claim_next_episode()) = 1 and (select count(*) from claim_next_episode()) = 1 and (select count(*) from claim_next_episode()) = 0, 'episodes are claimed one at a time, none twice');
update podcast_episodes set locked_at = now() - interval '20 minutes';
select ok((select count(*) from claim_next_episode()) = 1, 'stuck episode (dead worker) is re-claimed');
update podcast_episodes set status='queued', attempts=3;
select ok((select count(*) from claim_next_episode()) = 0, 'episodes stop retrying after 3 attempts');

-- ---------- doc intelligence ----------
insert into oneclist_items(user_id,title,doc_type,doc_vendor,doc_date,doc_total,doc_currency) values
 (:'A','r1','receipt','Blue Bottle','2026-10-01',12.50,'USD'),(:'A','r2','receipt','Blue Bottle','2026-10-05',7.25,'USD'),
 (:'A','r3','receipt','Blue Bottle','2026-10-06',300,'INR'),(:'A','r4','invoice','Acme','2026-09-01',99,'USD');
select ok((select total from spend_summary(:'A','2026-10-01','2026-10-31') where vendor='Blue Bottle' and currency='USD') = 19.75, 'spend_summary sums USD per vendor');
select ok((select count(*) from spend_summary(:'A','2026-10-01','2026-10-31') where vendor='Blue Bottle') = 2, 'currencies are never mixed');
do $$ begin begin insert into oneclist_items(user_id,title,doc_total) values ('00000000-0000-0000-0000-00000000000a','neg',-1); raise exception 'FAIL: negative total allowed'; exception when check_violation then raise notice 'ok   negative totals rejected'; end; end $$;
do $$ begin begin insert into oneclist_items(user_id,title,doc_type) values ('00000000-0000-0000-0000-00000000000a','bad','passport'); raise exception 'FAIL: bad doc_type allowed'; exception when check_violation then raise notice 'ok   unknown doc_type rejected'; end; end $$;
