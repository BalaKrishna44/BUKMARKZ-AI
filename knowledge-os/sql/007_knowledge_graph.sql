-- 007: semantic edges between a user's items (bookmarks, notes, articles, scanned photos).
create table if not exists item_edges (
  user_id          uuid not null references auth.users(id) on delete cascade,
  source_item_id   uuid not null references oneclist_items(id) on delete cascade,
  target_item_id   uuid not null references oneclist_items(id) on delete cascade,
  similarity_score real not null check (similarity_score between -1 and 1),
  updated_at       timestamptz not null default now(),
  primary key (source_item_id, target_item_id),
  check (source_item_id < target_item_id)             -- one row per undirected pair
);
create index if not exists item_edges_user_score_idx on item_edges (user_id, similarity_score desc);
create index if not exists item_edges_target_idx on item_edges (target_item_id);

alter table item_edges enable row level security;
do $$ begin create policy edges_select on item_edges for select using (auth.uid() = user_id); exception when duplicate_object then null; end $$;
revoke insert, update, delete on item_edges from anon, authenticated;

/*
  rebuild_item_edges: for each seed item take its p_k nearest neighbours (cosine), keep pairs >= p_threshold.
    p_item_ids null  => every embedded item of the user (full rebuild)
    p_item_ids given => incremental: only edges touching those items are recomputed (call it after enrichment)
  - neighbours must share the seed's embedding_model (vectors from different models are not comparable)
  - rows touching the seeds are deleted first, so edges that no longer qualify disappear
  - uses the HNSW index; with a per-user filter turn on pgvector 0.8 iterative scans so the filter cannot starve results
  Returns the number of edges written. Service role only.
*/
create or replace function rebuild_item_edges(
  p_user      uuid,
  p_threshold float default 0.80,
  p_k         int   default 8,
  p_item_ids  uuid[] default null
) returns int language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
  perform set_config('hnsw.ef_search', '100', true);
  p_k := greatest(1, least(p_k, 30));

  drop table if exists pg_temp._seeds;
  create temporary table _seeds on commit drop as
    select id, embedding, embedding_model from oneclist_items
    where user_id = p_user and embedding is not null and (p_item_ids is null or id = any (p_item_ids));

  delete from item_edges e
  where e.user_id = p_user and (e.source_item_id in (select id from _seeds) or e.target_item_id in (select id from _seeds));

  insert into item_edges (user_id, source_item_id, target_item_id, similarity_score)
  select p_user, least(s.id, nb.id), greatest(s.id, nb.id), max(nb.sim)::real
  from _seeds s
  cross join lateral (
    select o.id, 1 - (o.embedding <=> s.embedding) as sim
    from oneclist_items o
    where o.user_id = p_user and o.id <> s.id and o.embedding is not null
      and o.embedding_model is not distinct from s.embedding_model
    order by o.embedding <=> s.embedding
    limit p_k
  ) nb
  where nb.sim >= p_threshold
  group by 2, 3
  on conflict (source_item_id, target_item_id) do update set similarity_score = excluded.similarity_score, updated_at = now();

  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function rebuild_item_edges(uuid, float, int, uuid[]) from public, anon, authenticated;
grant execute on function rebuild_item_edges(uuid, float, int, uuid[]) to service_role;
