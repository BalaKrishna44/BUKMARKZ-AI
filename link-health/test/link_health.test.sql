\set ON_ERROR_STOP 0
create or replace function t_ok(c boolean, m text) returns void language plpgsql as $$ begin if c then raise notice 'ok - %', m; else raise notice 'FAIL: %', m; end if; end $$;
insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000a1') on conflict do nothing;
delete from oneclist_items;
insert into oneclist_items(id,user_id,url,url_key,link_next_check_at) values
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','https://a.com/1','a.com/1', now()-interval '1 hour'),
 ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a1','https://a.com/2','a.com/2', now()+interval '1 day'),
 ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000a1','bukmarkz://voice/x','voice/x', now()-interval '1 hour'),
 ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-0000000000a1','javascript:alert(1)','js/1', now()-interval '1 hour');
select t_ok((select count(*) from link_health_claim(50)) = 1, 'claim returns only due http(s) rows');
select t_ok((select count(*) from link_health_claim(50)) = 0, 'second claim gets nothing (already claimed)');
update oneclist_items set link_claimed_at = now()-interval '11 minutes' where id='00000000-0000-0000-0000-000000000001';
select t_ok((select count(*) from link_health_claim(50)) = 1, 'abandoned claim (>10 min) is re-claimable');
select link_health_release(array['00000000-0000-0000-0000-000000000001']::uuid[]);
select t_ok((select link_claimed_at is null from oneclist_items where id='00000000-0000-0000-0000-000000000001'), 'release clears claim');

-- hard failures: dead on the 2nd
select * from link_health_apply('00000000-0000-0000-0000-000000000001','hard',404,'http_404','https://web.archive.org/web/20240131120000/https://a.com/1','2024-01-31T12:00:00Z');
select t_ok(not (select is_dead from oneclist_items where id='00000000-0000-0000-0000-000000000001'), 'one hard failure is not dead yet');
select t_ok((select count(*) from link_health_apply('00000000-0000-0000-0000-000000000001','hard',404,'http_404',null,null) where newly_dead) = 1, 'second hard failure => newly_dead');
select t_ok((select is_dead and archive_url like 'https://web.archive.org/%' and dead_since is not null and link_next_check_at > now()+interval '6 days' from oneclist_items where id='00000000-0000-0000-0000-000000000001'), 'dead + archive_url kept (later call passed null) + recheck in 7d');
select t_ok((select count(*) from link_health_apply('00000000-0000-0000-0000-000000000001','hard',404,'http_404',null,null) where newly_dead) = 0, 'already-dead is not "newly" dead again');
-- recovery
select * from link_health_apply('00000000-0000-0000-0000-000000000001','ok',200,null,null,null);
select t_ok((select not is_dead and link_fail_count=0 and dead_since is null and archive_url is not null from oneclist_items where id='00000000-0000-0000-0000-000000000001'), 'recovery clears dead flag, keeps snapshot');
-- soft failures: dead on the 3rd
select * from link_health_apply('00000000-0000-0000-0000-000000000002','soft',503,'http_503',null,null);
select * from link_health_apply('00000000-0000-0000-0000-000000000002','soft',null,'timeout',null,null);
select t_ok(not (select is_dead from oneclist_items where id='00000000-0000-0000-0000-000000000002'), 'two soft failures not dead');
select * from link_health_apply('00000000-0000-0000-0000-000000000002','soft',500,'http_500',null,null);
select t_ok((select is_dead from oneclist_items where id='00000000-0000-0000-0000-000000000002'), 'three soft failures => dead');
-- hostile archive_url is ignored, not stored
select * from link_health_apply('00000000-0000-0000-0000-000000000004','soft',null,'x',null,null);
select * from link_health_apply('00000000-0000-0000-0000-000000000004','soft',null,'x','javascript:alert(1)',null);
select t_ok((select archive_url is null from oneclist_items where id='00000000-0000-0000-0000-000000000004'), 'non-Wayback archive_url ignored');
select * from link_health_apply('00000000-0000-0000-0000-000000000004','soft',null,'Bad Err!<script>',null,null);
select t_ok((select link_error = 'adrscript' or link_error ~ '^[a-z0-9_]+$' from oneclist_items where id='00000000-0000-0000-0000-000000000004'), 'error text sanitized to a short code');
-- direct writes bypassing the function still hit the CHECK
do $$ begin begin update oneclist_items set archive_url='https://evil.com/web/1/https://a.com' where id='00000000-0000-0000-0000-000000000001'; raise notice 'FAIL: CHECK allowed evil archive_url'; exception when check_violation then raise notice 'ok - CHECK blocks non-Wayback archive_url'; end; end $$;
do $$ begin begin perform link_health_apply('00000000-0000-0000-0000-000000000001','bogus'); raise notice 'FAIL: bad outcome accepted'; exception when others then raise notice 'ok - bad outcome rejected'; end; end $$;
-- skip
select * from link_health_apply('00000000-0000-0000-0000-000000000003','skip',null,'private_host',null,null);
select t_ok((select link_next_check_at > now()+interval '13 days' and not is_dead from oneclist_items where id='00000000-0000-0000-0000-000000000003'), 'skip reschedules 14d, not dead');
-- privileges
select t_ok(not has_function_privilege('anon','link_health_apply(uuid,text,int,text,text,timestamptz)','execute') and not has_function_privilege('authenticated','link_health_claim(int)','execute'), 'anon/authenticated cannot execute');
select t_ok(has_function_privilege('service_role','link_health_claim(int)','execute'), 'service_role can execute');
-- re-runnable
\ir ../sql/030_link_health.sql
select t_ok(true, 'migration re-runs cleanly');
