-- Bukmarkz AI features. Needs PostgreSQL 14+ and the pgvector extension, version 0.8.0 or newer
-- (0.8.0 added iterative index scans, which keep filtered vector searches from returning too few rows).
--
-- Prerequisite: a `bookmarks` table with at least  id uuid primary key, user_id uuid, url text, note text, source text,
-- created_at timestamptz  (the one from the share-sheet kit). Different names? Edit the ALTERs and the SQL in src/repo.ts.

create extension if not exists vector;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Extra columns on bookmarks
-- ---------------------------------------------------------------------------------------------------------------------
alter table bookmarks
  add column if not exists title            text,
  add column if not exists platform         text,                        -- instagram | linkedin | x | youtube | tiktok | reddit | web | screenshot
  add column if not exists content_text     text,                        -- searchable plain text: OCR + takeaways + transcript
  add column if not exists summary          text,
  add column if not exists tags             text[]       not null default '{}',
  add column if not exists is_private       boolean      not null default false,   -- private items never reach a model, an index or a push
  add column if not exists first_opened_at  timestamptz,                 -- set the first time the user opens it (see mark_bookmark_opened)
  add column if not exists archived_at      timestamptz,
  add column if not exists ai_status        text         not null default 'pending'
        check (ai_status in ('pending', 'processing', 'done', 'failed', 'skipped_private')),
  add column if not exists ai_processed_at  timestamptz,
  add column if not exists ai_attempts      integer      not null default 0,
  add column if not exists ai_error         text;

create index if not exists bookmarks_unread_idx
  on bookmarks (created_at)
  where first_opened_at is null and archived_at is null and is_private = false;   -- what the 48h scheduler scans

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Search index: one row per chunk of text, with its vector and a full-text column.
--    platform / saved_at / is_private are COPIES of the bookmark's values, so a filtered vector search needs no join
--    (a join would stop Postgres using the HNSW index). The trigger below keeps the copies in sync.
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists bookmark_chunks (
  id           uuid primary key default gen_random_uuid(),
  bookmark_id  uuid        not null references bookmarks (id) on delete cascade,
  user_id      uuid        not null,
  chunk_index  integer     not null,
  content      text        not null,
  platform     text,
  saved_at     timestamptz not null,
  is_private   boolean     not null default false,
  embedding    vector(1536),                                              -- null until embedded: full-text still works meanwhile
  fts          tsvector generated always as (to_tsvector('english', content)) stored,   -- change 'english' for other languages
  created_at   timestamptz not null default now(),
  unique (bookmark_id, chunk_index)
);

create index if not exists bookmark_chunks_user_idx      on bookmark_chunks (user_id);
create index if not exists bookmark_chunks_fts_idx       on bookmark_chunks using gin (fts);
create index if not exists bookmark_chunks_embedding_idx on bookmark_chunks using hnsw (embedding vector_cosine_ops);

create or replace function sync_chunk_flags() returns trigger language plpgsql as $$
begin
  if new.is_private then
    delete from bookmark_chunks where bookmark_id = new.id;          -- going private removes it from search entirely
  elsif new.platform is distinct from old.platform or new.created_at is distinct from old.created_at then
    update bookmark_chunks set platform = new.platform, saved_at = new.created_at where bookmark_id = new.id;
  end if;
  return new;
end
$$;

drop trigger if exists bookmarks_sync_chunk_flags on bookmarks;
create trigger bookmarks_sync_chunk_flags
  after update of is_private, platform, created_at on bookmarks
  for each row execute function sync_chunk_flags();

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Hybrid search: vector rank + full-text rank, merged with Reciprocal Rank Fusion  score = 1/(k+rank_vec) + 1/(k+rank_fts)
--    p_tsquery is a tsquery string built by the app from sanitized keywords, e.g. 'react | ui | library'.
--    Either side may be null (no embedding / no keywords): the other still works.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function search_chunks(
  p_user_id    uuid,
  p_tsquery    text,
  p_embedding  vector default null,
  p_platform   text default null,
  p_from       timestamptz default null,
  p_to         timestamptz default null,
  p_limit      integer default 12,
  p_candidates integer default 40,
  p_rrf_k      integer default 60
)
returns table (
  chunk_id uuid, bookmark_id uuid, chunk_index integer, content text,
  title text, url text, platform text, saved_at timestamptz,
  score double precision, vec_rank integer, fts_rank integer
)
language sql stable
as $$
  with vec as materialized (
    select v.id, (row_number() over (order by v.dist))::integer as rnk
    from (
      select c.id, c.embedding <=> p_embedding as dist
      from bookmark_chunks c
      where p_embedding is not null
        and c.user_id = p_user_id
        and c.is_private = false
        and c.embedding is not null
        and (p_platform is null or c.platform = p_platform)
        and (p_from is null or c.saved_at >= p_from)
        and (p_to   is null or c.saved_at <  p_to)
      order by c.embedding <=> p_embedding
      limit p_candidates
    ) v
  ),
  fts as materialized (
    select f.id, (row_number() over (order by f.rank desc))::integer as rnk
    from (
      select c.id, ts_rank_cd(c.fts, to_tsquery('english', p_tsquery)) as rank
      from bookmark_chunks c
      where p_tsquery is not null
        and c.user_id = p_user_id
        and c.is_private = false
        and c.fts @@ to_tsquery('english', p_tsquery)
        and (p_platform is null or c.platform = p_platform)
        and (p_from is null or c.saved_at >= p_from)
        and (p_to   is null or c.saved_at <  p_to)
      order by rank desc
      limit p_candidates
    ) f
  ),
  fused as (
    select coalesce(v.id, f.id) as id,
           coalesce(1.0 / (p_rrf_k + v.rnk), 0) + coalesce(1.0 / (p_rrf_k + f.rnk), 0) as score,
           v.rnk as vec_rank,
           f.rnk as fts_rank
    from vec v
    full outer join fts f on f.id = v.id
  )
  select c.id, c.bookmark_id, c.chunk_index, c.content,
         b.title, b.url, c.platform, c.saved_at,
         u.score::double precision, u.vec_rank, u.fts_rank
  from fused u
  join bookmark_chunks c on c.id = u.id
  join bookmarks b on b.id = c.bookmark_id
  where c.user_id = p_user_id          -- belt and braces: never return another user's row
  order by u.score desc, c.saved_at desc
  limit p_limit;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Oneclist: the inbox the AI checklist steps land in
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists oneclist_items (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid        not null,
  bookmark_id      uuid        references bookmarks (id) on delete cascade,
  title            text        not null,
  detail           text,
  done_when        text,
  estimate_minutes smallint,
  position         smallint    not null default 0,
  kind             text        not null default 'action' check (kind in ('action', 'note', 'link')),
  source           text        not null default 'ai'     check (source in ('ai', 'user')),
  done_at          timestamptz,
  due_at           timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists oneclist_user_open_idx on oneclist_items (user_id, created_at desc) where done_at is null;
-- One AI step per position per bookmark: a retried job can't insert the same checklist twice.
create unique index if not exists oneclist_ai_step_key on oneclist_items (bookmark_id, position) where source = 'ai';

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Reminders
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists notification_prefs (
  user_id      uuid primary key,
  timezone     text     not null default 'UTC',          -- IANA name, e.g. 'Asia/Kolkata'
  push_enabled boolean  not null default true
);

create table if not exists reminder_queue (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid        not null,
  bookmark_id  uuid        not null references bookmarks (id) on delete cascade,
  kind         text        not null check (kind in ('review_48h')),
  payload      jsonb       not null,
  send_after   timestamptz not null,
  status       text        not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  attempts     integer     not null default 0,
  claimed_at   timestamptz,
  last_error   text,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  unique (bookmark_id, kind)                              -- one nudge per bookmark, ever: the scheduler can run any number of times
);

create index if not exists reminder_queue_due_idx on reminder_queue (send_after) where status in ('pending', 'sending');
create index if not exists reminder_queue_user_day_idx on reminder_queue (user_id, send_after);

-- Call this when the user opens a bookmark: it stops the nudge before it is ever sent.
create or replace function mark_bookmark_opened(p_user_id uuid, p_bookmark_id uuid) returns void language sql as $$
  update bookmarks set first_opened_at = coalesce(first_opened_at, now()) where id = p_bookmark_id and user_id = p_user_id;
  update reminder_queue set status = 'cancelled' where bookmark_id = p_bookmark_id and user_id = p_user_id and status = 'pending';
$$;
