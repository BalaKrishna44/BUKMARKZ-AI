\set ON_ERROR_STOP off
insert into auth.users(id) values ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b');
insert into bookmarks(id,user_id,url,is_private) values
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000a','https://a.example/x',false);
insert into bookmark_chunks(bookmark_id,user_id,chunk_index,content,saved_at) values
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000a',0,'secret postgres pooling notes',now());
insert into reminder_queue(user_id,bookmark_id,kind,payload,send_after) values
 ('00000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-00000000000a','review_48h','{}',now());
insert into notification_prefs(user_id) values ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b');

grant all on all tables in schema public to service_role;   -- Supabase does this by default; the stand-in does not
create function pg_temp.try(role_ text, uid text, sql_ text, expect text, label text) returns void language plpgsql as $$
declare n int; ok boolean;
begin
  execute format('set local role %I', role_);
  perform set_config('request.jwt.claim.sub', uid, true);
  begin
    execute 'select count(*) from (' || sql_ || ') q' into n; ok := (expect = 'rows' and n > 0) or (expect = 'none' and n = 0);
    if ok then raise notice 'ok - %', label; else raise notice 'FAIL: % (got % rows, wanted %)', label, n, expect; end if;
  exception when insufficient_privilege then
    if expect = 'denied' then raise notice 'ok - %', label; else raise notice 'FAIL: % (permission denied)', label; end if;
  end;
  reset role;
end $$;

select pg_temp.try('anon','','select * from bookmark_chunks','denied','anon cannot read the search index');
select pg_temp.try('authenticated','00000000-0000-0000-0000-00000000000b','select * from bookmark_chunks','denied','another signed-in user cannot read the index');
select pg_temp.try('authenticated','00000000-0000-0000-0000-00000000000a','select * from bookmark_chunks','denied','even the owner reads through the server, not the table');
select pg_temp.try('anon','','select * from reminder_queue','denied','anon cannot read reminders');
select pg_temp.try('authenticated','00000000-0000-0000-0000-00000000000b','select * from reminder_queue','denied','user B cannot read user A reminders');
select pg_temp.try('anon','','select * from notification_prefs','denied','anon cannot read prefs');
select pg_temp.try('authenticated','00000000-0000-0000-0000-00000000000b','select * from notification_prefs','rows','user sees prefs...');
select pg_temp.try('authenticated','00000000-0000-0000-0000-00000000000b',$$select * from notification_prefs where user_id='00000000-0000-0000-0000-00000000000a'$$,'none','...but only their own row');
select pg_temp.try('authenticated','00000000-0000-0000-0000-00000000000b',$$select * from search_chunks('00000000-0000-0000-0000-00000000000a','postgres',null)$$,'denied','user B cannot call search_chunks with user A id');
select pg_temp.try('anon','',$$select * from search_chunks('00000000-0000-0000-0000-00000000000a','postgres',null)$$,'denied','anon cannot call search_chunks');
select pg_temp.try('service_role','',$$select * from search_chunks('00000000-0000-0000-0000-00000000000a','postgres',null)$$,'rows','server (service_role) still searches');
