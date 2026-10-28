-- 006: columns for the enrichment worker. Safe to re-run.
alter table public.oneclist_items
  add column if not exists og_image          text,
  add column if not exists suggested_actions text[]      not null default '{}',
  add column if not exists enrich_attempts   int         not null default 0,
  add column if not exists enrich_error      text,
  add column if not exists enrich_claimed_at timestamptz,
  add column if not exists enriched_at       timestamptz;

-- The worker finds work by status, so keep that lookup cheap.
create index if not exists oneclist_items_enrich_queue_idx
  on public.oneclist_items (status, created_at desc)
  where status in ('pending', 'processing');

-- Status values used by the worker: 'pending' -> 'processing' -> 'processed' | 'failed'.
-- Make sure NEW rows start as 'pending' (adjust if your ingest already uses another default):
-- alter table public.oneclist_items alter column status set default 'pending';

-- Each user's categories are created on first use by the worker, so (user_id, slug) must be unique:
create unique index if not exists categories_user_slug_key on public.categories (user_id, slug);
