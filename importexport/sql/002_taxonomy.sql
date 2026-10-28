-- Taxonomy / auto-organise schema. Run after 001. Idempotent.
create table if not exists categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  slug        text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 30),
  name        text not null check (char_length(name) between 1 and 60),
  description text,
  position    int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (user_id, slug)
);
alter table categories enable row level security;
do $$ begin create policy categories_own on categories for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

alter table oneclist_items
  add column if not exists category_id uuid references categories(id) on delete set null,
  add column if not exists ai_tags     text[] not null default '{}',
  add column if not exists item_type   text   not null default 'link' check (item_type in ('link','oneclist_task'));
create index if not exists oneclist_items_category_idx on oneclist_items(user_id, category_id);
create index if not exists oneclist_items_ai_tags_gin  on oneclist_items using gin (ai_tags);
create index if not exists oneclist_items_unsorted_idx on oneclist_items(user_id) where category_id is null;

-- p_taxonomy: [{slug,name,description}] in display order. Upserts; never deletes categories.
create or replace function upsert_taxonomy(p_user uuid, p_taxonomy jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if jsonb_typeof(p_taxonomy) <> 'array' or jsonb_array_length(p_taxonomy) > 30 then raise exception 'bad taxonomy'; end if;
  with t as (select e, ord::int - 1 as pos from jsonb_array_elements(p_taxonomy) with ordinality x(e, ord)),
  u as (
    insert into categories(user_id, slug, name, description, position)
    select p_user, e->>'slug', left(e->>'name', 60), left(e->>'description', 300), pos from t
    on conflict (user_id, slug) do update set name = excluded.name, description = excluded.description, position = excluded.position
    returning 1)
  select count(*) into n from u;
  return n;
end $$;

-- p_rows: [{id, category(slug), ai_tags[], item_type}]. One set-based UPDATE (≈ms for 100 rows), so 300+ items
-- never come near statement_timeout. Rows the user already categorised are kept unless p_overwrite.
create or replace function apply_taxonomy_assignments(p_user uuid, p_rows jsonb, p_overwrite boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then raise exception 'p_rows must be an array of at most 500'; end if;
  create temp table if not exists _asg(id uuid, slug text, ai_tags text[], item_type text) on commit drop;
  truncate _asg;
  insert into _asg
    select (e->>'id')::uuid, e->>'category', array(select jsonb_array_elements_text(coalesce(e->'ai_tags','[]'::jsonb))), e->>'item_type'
    from jsonb_array_elements(p_rows) e;
  if exists (select 1 from _asg a left join categories c on c.user_id = p_user and c.slug = a.slug where c.id is null) then
    raise exception 'assignment references an unknown category slug';
  end if;
  update oneclist_items i set
      category_id = c.id, ai_tags = a.ai_tags, item_type = a.item_type,
      status = case when a.item_type = 'oneclist_task' then 'actionable_task' else 'bookmark' end  -- keep 001's status in sync
  from _asg a join categories c on c.user_id = p_user and c.slug = a.slug
  where i.id = a.id and i.user_id = p_user and (p_overwrite or i.category_id is null);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function upsert_taxonomy(uuid,jsonb), apply_taxonomy_assignments(uuid,jsonb,boolean) from public, anon, authenticated;
grant execute on function upsert_taxonomy(uuid,jsonb), apply_taxonomy_assignments(uuid,jsonb,boolean) to service_role;
