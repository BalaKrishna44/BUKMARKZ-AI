-- 032: GDPR / DPDP erasure. erase_user_data(user) removes EVERY row the user owns, in every public table that has a uuid user_id column.
-- Why a function and not just "delete the auth user": some tables (for example the vault table, embeddings chunks and reminders from the ai-engine
-- migration) have a user_id with no foreign key to auth.users, so deleting the login would leave the vault and its vector embeddings behind.
-- It discovers tables at run time, so tables added by future migrations are covered automatically. Re-runnable; service role only.
--
-- Teams: a user who is the LAST OWNER of an organisation that still has other members cannot be erased (error org_owner_blocked): they must
-- transfer ownership or remove the members first. Content a user authored inside an organisation passes to another owner so teammates keep it;
-- an organisation with no other member is deleted with its content.
create or replace function erase_user_data(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t text; pending text[]; nxt text[]; pass int := 0; n bigint; total bigint := 0; heir uuid; o record; tbl text;
begin
  if p_user is null then raise exception 'bad_user' using errcode = '22023'; end if;

  if to_regclass('public.org_members') is not null then
    if exists (select 1 from org_members m where m.user_id = p_user and m.role = 'owner'
               and not exists (select 1 from org_members w where w.org_id = m.org_id and w.role = 'owner' and w.user_id <> p_user)
               and exists (select 1 from org_members x where x.org_id = m.org_id and x.user_id <> p_user)) then
      raise exception 'org_owner_blocked' using errcode = 'P0001';
    end if;
    for o in select org_id from org_members where user_id = p_user loop
      if not exists (select 1 from org_members w where w.org_id = o.org_id and w.user_id <> p_user) then
        foreach tbl in array array['oneclist_items', 'stacks'] loop       -- sole member: the organisation goes away with its content
          if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = tbl and column_name = 'org_id') then
            execute format('delete from public.%I where org_id = $1', tbl) using o.org_id;
          end if;
        end loop;
        delete from organizations where id = o.org_id;
      else
        select w.user_id into heir from org_members w where w.org_id = o.org_id and w.role = 'owner' and w.user_id <> p_user order by w.joined_at limit 1;
        if heir is null then select w.user_id into heir from org_members w where w.org_id = o.org_id and w.user_id <> p_user order by w.joined_at limit 1; end if;
        foreach tbl in array array['oneclist_items', 'stacks'] loop
          if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = tbl and column_name = 'org_id') then
            execute format('update public.%I set user_id = $1 where user_id = $2 and org_id = $3', tbl) using heir, p_user, o.org_id;
          end if;
        end loop;
      end if;
    end loop;
  end if;

  select coalesce(array_agg(c.table_name order by c.table_name), '{}') into pending
  from information_schema.columns c
  join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
  where c.table_schema = 'public' and c.column_name = 'user_id' and c.udt_name = 'uuid';

  while coalesce(array_length(pending, 1), 0) > 0 and pass < 8 loop      -- foreign keys between tables: retry the ones that were blocked until children are gone
    pass := pass + 1; nxt := '{}';
    foreach t in array pending loop
      begin
        execute format('delete from public.%I where user_id = $1', t) using p_user;
        get diagnostics n = row_count; total := total + n;
      exception when foreign_key_violation then nxt := nxt || t;
      end;
    end loop;
    pending := nxt;
  end loop;
  if coalesce(array_length(pending, 1), 0) > 0 then raise exception 'erase_incomplete' using errcode = 'P0001', detail = array_to_string(pending, ','); end if;
  return jsonb_build_object('rows', total);
end $$;

revoke all on function erase_user_data(uuid) from public, anon, authenticated;
grant execute on function erase_user_data(uuid) to service_role;
