-- 023: for sitemap.xml only. Service role only (NOT anon): the public never enumerates stacks through the API.
create or replace function list_indexable_stacks(p_limit int default 5000, p_offset int default 0) returns table(slug text, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.slug, s.updated_at from stacks s
  where s.is_public and not s.is_blocked and (select count(*) from stack_items i where i.stack_id = s.id) >= 3
  order by s.updated_at desc limit greatest(1, least(p_limit, 50000)) offset greatest(0, p_offset);
$$;
revoke all on function list_indexable_stacks(int, int) from public, anon, authenticated;
grant execute on function list_indexable_stacks(int, int) to service_role;
