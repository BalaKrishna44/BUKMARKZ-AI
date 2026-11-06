-- Extra columns + batch loader for the Django → Supabase migration. Run after 001 and 002. Idempotent.
alter table oneclist_items
  add column if not exists is_private        boolean not null default false,  -- Django Category.private
  add column if not exists legacy_bookmark_id bigint;                         -- Django Bookmark.id (makes re-runs idempotent)
create unique index if not exists oneclist_items_legacy_uq on oneclist_items(user_id, legacy_bookmark_id) where legacy_bookmark_id is not null;

-- p_items: [{legacy_id, url, url_key, title, note, tags[], ai_tags[], folder[], is_private, created_at, embedding("[..]"|null)}]
-- Service role only. Anything already present (same URL or same legacy id) is skipped, never overwritten.
create or replace function migrate_legacy_batch(p_user uuid, p_items jsonb)
returns table(inserted int, duplicates int)
language plpgsql security definer set search_path = public as $$
declare r record; i int; v_ins int; v_total int;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 1000 then raise exception 'p_items must be an array of at most 1000'; end if;
  v_total := jsonb_array_length(p_items);

  for r in
    select distinct array(select jsonb_array_elements_text(e->'folder')) as path
    from jsonb_array_elements(p_items) e where jsonb_array_length(coalesce(e->'folder','[]'::jsonb)) > 0 order by 1
  loop
    for i in 1 .. cardinality(r.path) loop
      insert into collections(user_id, parent_id, name, path)
      values (p_user, (select c.id from collections c where c.user_id = p_user and c.path = r.path[1:i-1]), r.path[i], r.path[1:i])
      on conflict (user_id, path) do nothing;
    end loop;
  end loop;

  with src as (
    select (e->>'legacy_id')::bigint legacy_id, e->>'url' url, e->>'url_key' url_key,
           coalesce(nullif(e->>'title',''), e->>'url') title, nullif(e->>'note','') note,
           array(select jsonb_array_elements_text(coalesce(e->'tags','[]'::jsonb))) tags,
           array(select jsonb_array_elements_text(coalesce(e->'ai_tags','[]'::jsonb))) ai_tags,
           array(select jsonb_array_elements_text(coalesce(e->'folder','[]'::jsonb))) folder,
           coalesce((e->>'is_private')::boolean, false) is_private,
           coalesce(nullif(e->>'created_at','')::timestamptz, now()) created_at,
           nullif(e->>'embedding','') embedding
    from jsonb_array_elements(p_items) e
  ), ins as (
    insert into oneclist_items(user_id, url, url_key, title, note, tags, ai_tags, collection_id, is_private, created_at,
                               legacy_bookmark_id, source, embedding, ai_status)
    select p_user, s.url, s.url_key, s.title, s.note, s.tags, s.ai_tags, c.id, s.is_private, s.created_at,
           s.legacy_id, 'django-migration', s.embedding::vector, 'none'     -- never queued for the AI worker (private rows must not be sent out)
    from src s left join collections c on c.user_id = p_user and cardinality(s.folder) > 0 and c.path = s.folder
    on conflict do nothing
    returning 1
  ) select count(*) into v_ins from ins;
  inserted := v_ins; duplicates := v_total - v_ins;
  return next;
end $$;

revoke all on function migrate_legacy_batch(uuid, jsonb) from public, anon, authenticated;
grant execute on function migrate_legacy_batch(uuid, jsonb) to service_role;
