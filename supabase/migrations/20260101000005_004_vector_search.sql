-- ─────────────────────────────────────────────────────────────────────────────
-- 004: pgvector + hybrid (semantic + keyword) search for "Ask My Vault"
-- Paste into the Supabase SQL editor. Idempotent. Run after 001-003.
-- ─────────────────────────────────────────────────────────────────────────────
create extension if not exists vector with schema extensions;   -- Supabase keeps extensions in the "extensions" schema
-- (If your project installed it in "public", this is a no-op and everything below still resolves.)

-- 1. Columns ---------------------------------------------------------------------------------------------
alter table oneclist_items
  add column if not exists embedding            vector(1536),
  add column if not exists embedding_model      text,    -- e.g. 'text-embedding-3-small'. Vectors from different models are NOT comparable.
  add column if not exists ocr_extracted_text   text;    -- filled by the OCR step (not built yet; NULL until then)

-- The column must have fixed dimensions or the HNSW index cannot be built.
do $$
declare d int;
begin
  select a.atttypmod into d from pg_attribute a
  where a.attrelid = 'public.oneclist_items'::regclass and a.attname = 'embedding' and not a.attisdropped;
  if d is distinct from 1536 then
    raise exception 'oneclist_items.embedding must be vector(1536) (found typmod %). Re-embed with 1536 dimensions or change this script.', d;
  end if;
end $$;

-- 2. Full-text column (generated, so it can never go stale) ---------------------------------------------
-- Weights: title A, summary B, note B, OCR text C. left() keeps one huge OCR text under tsvector's 1 MB limit.
-- 'english' stems English words; use 'simple' if most of your content is not English.
-- NOTE: adding a STORED generated column rewrites the table once (brief lock). Fine for thousands of rows; for millions run it off-peak.
alter table oneclist_items
  add column if not exists fts tsvector generated always as (
      setweight(to_tsvector('english', left(coalesce(title, ''), 1000)), 'A')
   || setweight(to_tsvector('english', left(coalesce(summary, ''), 5000)), 'B')
   || setweight(to_tsvector('english', left(coalesce(note, ''), 20000)), 'B')
   || setweight(to_tsvector('english', left(coalesce(ocr_extracted_text, ''), 200000)), 'C')
  ) stored;

-- 3. Indexes ------------------------------------------------------------------------------------------------
-- HNSW with cosine distance. m=16 / ef_construction=64 are pgvector's defaults and a good start under ~1M rows.
-- Tip for big tables: run `set maintenance_work_mem = '1GB';` first, and use CREATE INDEX CONCURRENTLY from psql (not the editor).
create index if not exists oneclist_items_embedding_hnsw on oneclist_items using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);
create index if not exists oneclist_items_fts_gin on oneclist_items using gin (fts);
create index if not exists oneclist_items_user_idx on oneclist_items (user_id);

-- 4. Hybrid search -----------------------------------------------------------------------------------------------
-- Two candidate lists, fused with Reciprocal Rank Fusion (RRF):
--   semantic : nearest neighbours by cosine distance, kept only if similarity >= match_threshold
--   keyword  : full-text matches (websearch syntax: "exact phrase", -excluded, or) ranked by ts_rank_cd
--   score    = semantic_weight / (rrf_k + rank_semantic) + keyword_weight / (rrf_k + rank_keyword)
-- RRF needs no score normalisation, so a strong keyword hit (an invoice number in OCR text) still surfaces even
-- when its embedding is far from the question, and vice versa.
--
-- Security: SECURITY INVOKER, so row-level security applies too. user_id_param must equal the caller's auth.uid();
-- the service role (Edge Functions / server) has no auth.uid() and may pass any user, but results are ALWAYS filtered to that user.
create or replace function match_oneclist_items(
  query_embedding   vector(1536),
  user_id_param     uuid,
  match_threshold   float   default 0.25,   -- minimum cosine similarity (0..1) for the semantic leg; tune per embedding model
  match_count       int     default 10,     -- clamped to 1..50
  query_text        text    default null,   -- the user's question/keywords; NULL or blank = semantic only
  include_private   boolean default false,  -- private items are excluded unless the caller explicitly opts in
  embedding_model_param text default null,  -- only compare against vectors made by this model
  semantic_weight   float   default 1.0,
  keyword_weight    float   default 1.0,
  rrf_k             int     default 50
)
returns table (
  id uuid, url text, title text, summary text, note text, tags text[], ai_tags text[], category_id uuid,
  similarity float, text_rank float, score float, match_type text, created_at timestamptz
)
language plpgsql stable security invoker
set search_path = public, extensions
as $$
declare
  v_n   int := greatest(1, least(coalesce(match_count, 10), 50));
  v_q   tsquery;
  v_pool int;
begin
  if user_id_param is null then raise exception 'user_id_param is required' using errcode = '22004'; end if;
  if auth.uid() is not null and auth.uid() <> user_id_param then
    raise exception 'not allowed to search another user''s items' using errcode = '42501';
  end if;
  if query_embedding is null then raise exception 'query_embedding is required' using errcode = '22004'; end if;

  v_pool := v_n * 4;                                         -- candidates per leg before fusion
  if nullif(btrim(query_text), '') is not null then v_q := websearch_to_tsquery('english', query_text); end if;  -- never throws on odd input

  -- HNSW is filtered AFTER the index scan, so one user's rows can be crowded out by other tenants' closer vectors.
  -- pgvector >= 0.8 fixes that with iterative scans; older versions simply ignore the attempt.
  begin
    perform set_config('hnsw.ef_search', '100', true);
    perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
  exception when others then null;
  end;

  return query
  with sem as (
    select s.id, s.sim, row_number() over (order by s.sim desc, s.id) as rnk
    from (
      select i.id, 1 - (i.embedding <=> query_embedding) as sim
      from oneclist_items i
      where i.user_id = user_id_param                                         -- tenant isolation (also enforced by RLS)
        and i.embedding is not null
        and (include_private or not i.is_private)
        and (embedding_model_param is null or i.embedding_model = embedding_model_param)
      order by i.embedding <=> query_embedding
      limit v_pool
    ) s
    where s.sim >= coalesce(match_threshold, 0)
  ),
  kw as (
    select k.id, k.tr, row_number() over (order by k.tr desc, k.id) as rnk
    from (
      select i.id, ts_rank_cd(i.fts, v_q, 32) as tr
      from oneclist_items i
      where v_q is not null
        and i.user_id = user_id_param
        and i.fts @@ v_q
        and (include_private or not i.is_private)
      order by ts_rank_cd(i.fts, v_q, 32) desc
      limit v_pool
    ) k
  ),
  fused as (
    select coalesce(sem.id, kw.id) as id, sem.sim, kw.tr,
           coalesce(semantic_weight / (rrf_k + sem.rnk), 0) + coalesce(keyword_weight / (rrf_k + kw.rnk), 0) as score,
           case when sem.id is not null and kw.id is not null then 'both' when sem.id is not null then 'semantic' else 'keyword' end as mt
    from sem full outer join kw on kw.id = sem.id
  )
  select i.id, i.url, i.title, i.summary, left(i.note, 2000), i.tags, i.ai_tags, i.category_id,
         coalesce(f.sim, 0)::float, coalesce(f.tr, 0)::float, f.score::float, f.mt, i.created_at
  from fused f
  join oneclist_items i on i.id = f.id and i.user_id = user_id_param           -- belt and braces
  order by f.score desc, i.created_at desc
  limit v_n;
end $$;

comment on function match_oneclist_items is 'Hybrid semantic + full-text search over the caller''s own items (RRF fusion).';

-- Callable by signed-in users and by the server (service role). Never by anonymous visitors.
revoke all on function match_oneclist_items(vector, uuid, float, int, text, boolean, text, float, float, int) from public, anon;
grant execute on function match_oneclist_items(vector, uuid, float, int, text, boolean, text, float, float, int) to authenticated, service_role;
