\set ON_ERROR_STOP off
create table a_parent(id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id));
create table a_child(id uuid primary key default gen_random_uuid(), user_id uuid not null, parent uuid not null references a_parent(id));
create table a_nofk(id uuid primary key default gen_random_uuid(), user_id uuid not null);
create table a_text(id uuid primary key default gen_random_uuid(), user_id text);
create table organizations(id uuid primary key default gen_random_uuid());
create table org_members(org_id uuid, user_id uuid, role text, joined_at timestamptz default now());
drop table if exists oneclist_items cascade; drop table if exists stacks cascade;
create table oneclist_items(id uuid primary key default gen_random_uuid(), user_id uuid, org_id uuid);
create table stacks(id uuid primary key default gen_random_uuid(), user_id uuid, org_id uuid);
\i :migration
create or replace function chk(n text, c boolean) returns void language plpgsql as $$ begin if c then raise notice 'ok %', n; else raise notice 'FAIL %', n; end if; end $$;
insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000a1'),('00000000-0000-0000-0000-0000000000b2'),('00000000-0000-0000-0000-0000000000c3');
\set a '\'00000000-0000-0000-0000-0000000000a1\''
\set b '\'00000000-0000-0000-0000-0000000000b2\''
\set c '\'00000000-0000-0000-0000-0000000000c3\''
insert into a_parent(id,user_id) values ('11111111-1111-1111-1111-111111111111',:a),('22222222-2222-2222-2222-222222222222',:b);
insert into a_child(user_id,parent) values (:a,'11111111-1111-1111-1111-111111111111'),(:b,'22222222-2222-2222-2222-222222222222');
insert into a_nofk(user_id) values (:a),(:a),(:b);
insert into a_text(user_id) values (:a);
-- orgs: o1 sole member a; o2 a owner + b owner; o3 a sole owner + c member
insert into organizations(id) values ('aaaaaaaa-0000-0000-0000-000000000001'),('aaaaaaaa-0000-0000-0000-000000000002'),('aaaaaaaa-0000-0000-0000-000000000003');
insert into org_members(org_id,user_id,role) values
 ('aaaaaaaa-0000-0000-0000-000000000001',:a,'owner'),
 ('aaaaaaaa-0000-0000-0000-000000000002',:a,'owner'),('aaaaaaaa-0000-0000-0000-000000000002',:b,'owner'),
 ('aaaaaaaa-0000-0000-0000-000000000003',:a,'owner'),('aaaaaaaa-0000-0000-0000-000000000003',:c,'member');
insert into oneclist_items(user_id,org_id) values (:a,'aaaaaaaa-0000-0000-0000-000000000001'),(:a,'aaaaaaaa-0000-0000-0000-000000000002');

-- blocked: a is last owner of o3 which has member c
do $$ declare e text; begin
  begin perform erase_user_data('00000000-0000-0000-0000-0000000000a1'); e := 'none'; exception when others then e := sqlerrm; end;
  perform chk('last owner with members is blocked', e = 'org_owner_blocked');
  perform chk('blocked erase changed nothing', (select count(*) from a_nofk where user_id='00000000-0000-0000-0000-0000000000a1') = 2);
end $$;
delete from org_members where org_id='aaaaaaaa-0000-0000-0000-000000000003' and user_id=:c;
do $$ declare r jsonb; begin
  r := erase_user_data('00000000-0000-0000-0000-0000000000a1');
  perform chk('returns row count', (r->>'rows')::int >= 6);
  perform chk('parent+child (FK order) gone', (select count(*) from a_parent where user_id='00000000-0000-0000-0000-0000000000a1')=0 and (select count(*) from a_child where user_id='00000000-0000-0000-0000-0000000000a1')=0);
  perform chk('table without FK cleaned', (select count(*) from a_nofk where user_id='00000000-0000-0000-0000-0000000000a1')=0);
  perform chk('text user_id column ignored', (select count(*) from a_text)=1);
  perform chk('other user untouched', (select count(*) from a_parent)=1 and (select count(*) from a_child)=1 and (select count(*) from a_nofk)=1);
  perform chk('solo org deleted', not exists(select 1 from organizations where id='aaaaaaaa-0000-0000-0000-000000000001'));
  perform chk('solo org items deleted', (select count(*) from oneclist_items where org_id='aaaaaaaa-0000-0000-0000-000000000001')=0);
  perform chk('shared org item passed to other owner', (select user_id from oneclist_items where org_id='aaaaaaaa-0000-0000-0000-000000000002')='00000000-0000-0000-0000-0000000000b2');
  perform chk('sole-member org (after member left) deleted', not exists(select 1 from organizations where id='aaaaaaaa-0000-0000-0000-000000000003'));
  perform chk('membership rows gone', (select count(*) from org_members where user_id='00000000-0000-0000-0000-0000000000a1')=0);
  r := erase_user_data('00000000-0000-0000-0000-0000000000a1');
  perform chk('re-runnable', (r->>'rows')::int = 0);
end $$;
do $$ declare e text; begin
  begin perform erase_user_data(null); e:='none'; exception when others then e:=sqlstate; end;
  perform chk('null user rejected', e='22023');
end $$;
do $$ begin
  perform chk('anon cannot execute', not has_function_privilege('anon','erase_user_data(uuid)','execute'));
  perform chk('authenticated cannot execute', not has_function_privilege('authenticated','erase_user_data(uuid)','execute'));
  perform chk('service_role can execute', has_function_privilege('service_role','erase_user_data(uuid)','execute'));
end $$;
