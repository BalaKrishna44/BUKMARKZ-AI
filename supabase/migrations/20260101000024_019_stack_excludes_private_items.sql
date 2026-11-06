-- 019_stack_excludes_private_items.sql
-- FOUND BY supabase/tests/rls.test.sql (3.7): create_stack() only skipped items whose ai_status is 'skipped_private' (set later, by the enrichment
-- worker). A link the user had just marked is_private = true was still copied into stack_items, and stacks are public by default, so get_public_stack()
-- served it to anonymous visitors. This redefines create_stack (as last defined in 017, org filter kept) with `not o.is_private` added.
-- Idempotent. Apply after 017.
create or replace function create_stack(p_title text, p_description text, p_theme text, p_slug text, p_handle text, p_items jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare uid uuid := auth.uid(); sid uuid; n int; h text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if (select count(*) from stacks where user_id = uid) >= 100 then raise exception 'too_many_stacks'; end if;
  if (select count(*) from stacks where user_id = uid and created_at > now() - interval '1 day') >= 20 then raise exception 'rate_limited'; end if;

  select handle into h from creator_profiles where user_id = uid;
  if h is null then
    if p_handle is null or p_handle !~ '^[a-z0-9_]{3,20}$' then raise exception 'handle_required'; end if;
    begin insert into creator_profiles(user_id, handle) values (uid, p_handle); h := p_handle;
    exception when unique_violation then raise exception 'handle_taken'; end;
  end if;

  begin
    insert into stacks(user_id, slug, title, description, theme) values (uid, lower(p_slug), btrim(p_title), nullif(btrim(coalesce(p_description,'')), ''), coalesce(p_theme,'mint'))
    returning id into sid;
  exception when unique_violation then raise exception 'slug_taken'; end;

  with src as (
    select o.id, o.url, o.title, e.ord, nullif(left(btrim(coalesce(e.j->>'blurb','')), 200), '') as blurb,
           row_number() over (partition by o.id order by e.ord) as dup
    from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) with ordinality as e(j, ord)
    join oneclist_items o on o.user_id = uid and o.org_id is null
      and e.j->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and o.id = (e.j->>'id')::uuid      -- a malformed id is skipped, not an error
    where o.url ~* '^https?://' and not o.is_private and coalesce(o.ai_status, '') <> 'skipped_private'   -- no scans (bukmarkz://), nothing the user marked private (is_private is set the instant they tick it; ai_status only after enrichment runs)
  ), picked as (
    select *, row_number() over (order by ord) - 1 as pos from src where dup = 1
  )
  insert into stack_items(stack_id, position, title, url, blurb)
  select sid, pos, left(coalesce(nullif(btrim(title), ''), substring(url from '^https?://([^/?#]+)')), 200), url, blurb from picked where pos < 50;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'no_valid_items'; end if;                                  -- aborts everything, stack row included
  return jsonb_build_object('id', sid, 'slug', lower(p_slug), 'count', n, 'handle', h);
end $$;
