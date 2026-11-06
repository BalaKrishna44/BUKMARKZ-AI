-- 009: offline page archive (Readability -> Markdown), full-text searchable, plus a private Storage bucket.
alter table oneclist_items
  add column if not exists archive_status     text not null default 'none'
    check (archive_status in ('none','pending','processing','done','failed')),
  add column if not exists archive_error      text,           -- short code only (see ArchiveErrorCode), never raw network text
  add column if not exists archive_attempts   int  not null default 0,
  add column if not exists archive_claimed_at timestamptz,
  add column if not exists archived_at        timestamptz,
  add column if not exists archive_path       text,           -- Storage object key inside the 'archives' bucket
  add column if not exists archive_title      text,
  add column if not exists archive_byline     text,
  add column if not exists archive_site       text,
  add column if not exists archive_lang       text,
  add column if not exists archive_words      int,
  add column if not exists archive_minutes    int,
  add column if not exists archive_truncated  boolean not null default false,
  add column if not exists archive_hash       text,           -- sha256 of the Markdown: lets re-archiving detect "page unchanged"
  add column if not exists full_markdown_content text;

-- 'simple' keeps every language searchable (no English stemming/stop-words). Generated, so it can never drift from the text.
alter table oneclist_items
  add column if not exists archive_fts tsvector generated always as (
    to_tsvector('simple', coalesce(archive_title,'') || ' ' || coalesce(full_markdown_content,''))
  ) stored;
create index if not exists items_archive_fts_idx   on oneclist_items using gin (archive_fts);
create index if not exists items_archive_queue_idx on oneclist_items (archive_status, archive_claimed_at)
  where archive_status in ('pending','processing','failed');

-- Private bucket. The worker writes with the service role; users may only READ objects under their own <user_id>/ folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('archives', 'archives', false, 2097152, array['text/markdown'])
  on conflict (id) do update set public = false, file_size_limit = 2097152, allowed_mime_types = array['text/markdown'];

drop policy if exists archives_owner_read on storage.objects;
create policy archives_owner_read on storage.objects for select to authenticated
  using (bucket_id = 'archives' and (storage.foldername(name))[1] = auth.uid()::text);

-- Search helper: ranked, with a highlighted snippet. SECURITY INVOKER, so RLS on oneclist_items still applies.
create or replace function search_archive(q text, lim int default 20)
returns table (id uuid, url text, title text, snippet text, rank real)
language sql stable security invoker set search_path = public as $$
  select i.id, i.url, coalesce(nullif(i.archive_title,''), i.title),
         ts_headline('simple', i.full_markdown_content, websearch_to_tsquery('simple', q),
                     'MaxFragments=2, MaxWords=30, MinWords=10, StartSel=«, StopSel=»'),
         ts_rank(i.archive_fts, websearch_to_tsquery('simple', q))
  from oneclist_items i
  where i.archive_status = 'done' and i.archive_fts @@ websearch_to_tsquery('simple', q)
  order by 5 desc limit least(greatest(lim,1),50);
$$;
