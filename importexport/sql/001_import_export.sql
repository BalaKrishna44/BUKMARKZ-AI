-- Bukmarkz import / export / AI enrichment schema (Supabase / PostgreSQL 15+)
-- Idempotent: safe to run on top of an existing oneclist_items table.
create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists collections (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  parent_id  uuid references collections(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 100),
  path       text[] not null,                       -- full path, e.g. {Dev,React}
  created_at timestamptz not null default now(),
  unique (user_id, path)
);
create index if not exists collections_parent_idx on collections(user_id, parent_id);

create table if not exists oneclist_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  url        text not null,
  title      text not null default '',
  created_at timestamptz not null default now()
);
-- add anything that is missing (no-ops if your table already has these)
alter table oneclist_items
  add column if not exists url_key        text,
  add column if not exists note           text,
  add column if not exists tags           text[] not null default '{}',
  add column if not exists collection_id  uuid references collections(id) on delete set null,
  add column if not exists status         text   not null default 'bookmark',
  add column if not exists category       text,
  add column if not exists summary        text,
  add column if not exists action_items   jsonb  not null default '[]',
  add column if not exists remind_at      timestamptz,
  add column if not exists embedding      vector(1536),
  add column if not exists source         text,
  add column if not exists import_job_id  uuid,
  add column if not exists ai_status      text   not null default 'none',
  add column if not exists ai_attempts    int    not null default 0,
  add column if not exists ai_locked_at   timestamptz;

do $$ begin
  alter table oneclist_items add constraint oneclist_items_status_chk check (status in ('bookmark','actionable_task'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table oneclist_items add constraint oneclist_items_ai_status_chk check (ai_status in ('none','pending','processing','done','failed'));
exception when duplicate_object then null; end $$;

-- Existing rows need a url_key before the unique index can be built. This is a coarse
-- backfill (lower-case, strip scheme/www/fragment/trailing slash); the app computes the precise key
-- for new rows. Duplicates among old rows are tolerated by suffixing the id.
update oneclist_items set url_key = lower(regexp_replace(regexp_replace(split_part(url,'#',1), '^https?://(www\.)?', ''), '/+$', ''))
  where url_key is null;
with d as (select id, row_number() over (partition by user_id, url_key order by created_at, id) rn from oneclist_items)
  update oneclist_items i set url_key = i.url_key || '#dup-' || i.id from d where d.id = i.id and d.rn > 1;
alter table oneclist_items alter column url_key set not null;
create unique index if not exists oneclist_items_user_urlkey_uq on oneclist_items(user_id, url_key);
create index if not exists oneclist_items_collection_idx on oneclist_items(user_id, collection_id);
create index if not exists oneclist_items_ai_idx on oneclist_items(import_job_id, ai_status);
create index if not exists oneclist_items_tags_gin on oneclist_items using gin (tags);
create index if not exists oneclist_items_embedding_hnsw on oneclist_items using hnsw (embedding vector_cosine_ops);

create table if not exists import_jobs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  source     text, filename text,
  total      int not null default 0, inserted int not null default 0,
  duplicates int not null default 0, skipped  int not null default 0,
  ai_enabled boolean not null default false,
  status     text not null default 'running' check (status in ('running','done','failed')),
  error      text,
  created_at timestamptz not null default now()
);

-- Row level security: users only ever see their own rows.
alter table collections    enable row level security;
alter table oneclist_items enable row level security;
alter table import_jobs    enable row level security;
do $$ begin create policy collections_own on collections for all using (auth.uid() = user_id) with check (auth.uid() = user_id); exception when duplicate_object then null; end $$;
do $$ begin create policy items_own       on oneclist_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id); exception when duplicate_object then null; end $$;
do $$ begin create policy jobs_own        on import_jobs for select using (auth.uid() = user_id); exception when duplicate_object then null; end $$;

/* ───────── bulk insert: one round trip per ≤500 rows ─────────
   Called ONLY by the server with the service-role key, after the route has authenticated the user. */
create or replace function import_bookmarks_batch(p_user uuid, p_job uuid, p_source text, p_ai boolean, p_items jsonb)
returns table(inserted int, duplicates int)
language plpgsql security definer set search_path = public as $$
declare r record; i int; v_ins int; v_total int;
begin
  if jsonb_typeof(p_items) <> 'array' then raise exception 'p_items must be a JSON array'; end if;
  v_total := jsonb_array_length(p_items);

  -- 1. folders → collections (create every ancestor, parents first)
  for r in
    select distinct array(select jsonb_array_elements_text(e->'folder')) as path
    from jsonb_array_elements(p_items) e
    where jsonb_array_length(coalesce(e->'folder','[]'::jsonb)) > 0
    order by 1
  loop
    for i in 1 .. cardinality(r.path) loop
      insert into collections(user_id, parent_id, name, path)
      values (p_user,
              (select c.id from collections c where c.user_id = p_user and c.path = r.path[1:i-1]),
              r.path[i], r.path[1:i])
      on conflict (user_id, path) do nothing;
    end loop;
  end loop;

  -- 2. bookmarks (existing URLs are skipped, never overwritten)
  with src as (
    select e->>'url' as url, e->>'url_key' as url_key,
           coalesce(nullif(e->>'title',''), e->>'url') as title,
           nullif(e->>'note','') as note,
           array(select jsonb_array_elements_text(coalesce(e->'tags','[]'::jsonb))) as tags,
           array(select jsonb_array_elements_text(coalesce(e->'folder','[]'::jsonb))) as folder,
           coalesce(nullif(e->>'created_at','')::timestamptz, now()) as created_at
    from jsonb_array_elements(p_items) e
  ), ins as (
    insert into oneclist_items(user_id, url, url_key, title, note, tags, collection_id, created_at, source, import_job_id, ai_status)
    select p_user, s.url, s.url_key, s.title, s.note, s.tags, c.id, s.created_at, p_source, p_job,
           case when p_ai then 'pending' else 'none' end
    from src s
    left join collections c on c.user_id = p_user and cardinality(s.folder) > 0 and c.path = s.folder
    on conflict (user_id, url_key) do nothing
    returning 1
  ) select count(*) into v_ins from ins;

  inserted := v_ins; duplicates := v_total - v_ins;
  update import_jobs set inserted = import_jobs.inserted + v_ins, duplicates = import_jobs.duplicates + (v_total - v_ins)
    where id = p_job and user_id = p_user;
  return next;
end $$;

/* ───────── AI worker queue ───────── */
-- Claims rows with FOR UPDATE SKIP LOCKED so parallel workers never take the same row.
-- Rows stuck in 'processing' for >10 min (crashed worker) are re-claimed; max 3 attempts.
create or replace function claim_ai_batch(p_user uuid, p_job uuid, p_limit int)
returns table(id uuid, url text, title text, note text, tags text[])
language sql security definer set search_path = public as $$
  update oneclist_items i set ai_status = 'processing', ai_locked_at = now(), ai_attempts = i.ai_attempts + 1
  where i.id in (
    select x.id from oneclist_items x
    where (p_user is null or x.user_id = p_user)
      and (p_job is null or x.import_job_id = p_job)
      and ((x.ai_status = 'pending') or (x.ai_status = 'processing' and x.ai_locked_at < now() - interval '10 minutes'))
      and x.ai_attempts < 3
    order by x.created_at, x.id
    limit greatest(1, least(p_limit, 100))
    for update skip locked)
  returning i.id, i.url, i.title, i.note, i.tags;
$$;

-- p_results: [{id, category, tags[], summary, status, action_items[], embedding:"[0.1,...]"|null}]
create or replace function apply_ai_results(p_results jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v int;
begin
  with r as (
    select (e->>'id')::uuid id, e->>'category' category,
           array(select jsonb_array_elements_text(coalesce(e->'tags','[]'::jsonb))) tags,
           e->>'summary' summary, e->>'status' status,
           coalesce(e->'action_items','[]'::jsonb) action_items, nullif(e->>'embedding','') embedding
    from jsonb_array_elements(p_results) e
  ), u as (
    update oneclist_items i set
      category = r.category, summary = r.summary, status = r.status, action_items = r.action_items,
      tags = (select coalesce(array_agg(distinct t), '{}') from unnest(i.tags || r.tags) t),  -- keep the user's own tags
      embedding = r.embedding::vector, ai_status = 'done', ai_locked_at = null
    from r where i.id = r.id and i.ai_status = 'processing'
    returning 1)
  select count(*) into v from u;
  return v;
end $$;

-- Give items back to the queue (or mark failed after 3 attempts).
create or replace function release_ai_items(p_ids uuid[])
returns void language sql security definer set search_path = public as $$
  update oneclist_items set ai_locked_at = null, ai_status = case when ai_attempts >= 3 then 'failed' else 'pending' end
  where id = any(p_ids) and ai_status = 'processing';
$$;

create or replace function ai_progress(p_user uuid, p_job uuid)
returns table(total int, done int, failed int)
language sql security definer set search_path = public as $$
  select count(*)::int, count(*) filter (where ai_status='done')::int, count(*) filter (where ai_status='failed')::int
  from oneclist_items where user_id = p_user and import_job_id = p_job and ai_status <> 'none';
$$;

-- Semantic search helper (RLS applies: call with the user's client, security invoker)
create or replace function match_items(p_embedding vector(1536), p_limit int default 20)
returns table(id uuid, title text, url text, similarity float)
language sql stable security invoker as $$
  select id, title, url, 1 - (embedding <=> p_embedding) from oneclist_items
  where embedding is not null order by embedding <=> p_embedding limit least(p_limit, 100);
$$;

-- These write on behalf of any user, so only the service role may call them.
revoke all on function import_bookmarks_batch(uuid,uuid,text,boolean,jsonb), claim_ai_batch(uuid,uuid,int),
  apply_ai_results(jsonb), release_ai_items(uuid[]), ai_progress(uuid,uuid) from public, anon, authenticated;
grant execute on function import_bookmarks_batch(uuid,uuid,text,boolean,jsonb), claim_ai_batch(uuid,uuid,int),
  apply_ai_results(jsonb), release_ai_items(uuid[]), ai_progress(uuid,uuid) to service_role;
