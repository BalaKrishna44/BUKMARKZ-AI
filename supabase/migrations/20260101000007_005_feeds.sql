-- 005: private RSS / news aggregator. Run after 001-004.
alter table oneclist_items add column if not exists content_text text;   -- cleaned article body (feeds, readability, podcasts read this)

create table if not exists feeds (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  url                  text not null,
  title                text,
  site_url             text,
  status               text not null default 'active' check (status in ('active','paused','broken')),
  fetch_interval_min   int  not null default 60 check (fetch_interval_min between 15 and 1440),
  etag                 text,
  last_modified        text,
  last_fetched_at      timestamptz,
  next_fetch_at        timestamptz not null default now(),
  leased_until         timestamptz,           -- set by claim_due_feeds so two workers never fetch the same feed
  consecutive_failures int  not null default 0,
  last_error           text,
  created_at           timestamptz not null default now(),
  unique (user_id, url)
);
create index if not exists feeds_due_idx on feeds (next_fetch_at) where status = 'active';

create table if not exists feed_entries (
  id            uuid primary key default gen_random_uuid(),
  feed_id       uuid not null references feeds(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  guid          text not null,
  url           text not null,
  title         text not null default '',
  author        text,
  published_at  timestamptz not null default now(),
  content_html  text,                         -- sanitized (allow-list), safe to render
  content_text  text,                         -- plain text, used for search / TTS / summaries
  excerpt       text,
  image_url     text,
  read_at       timestamptz,
  saved_item_id uuid references oneclist_items(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (feed_id, guid)
);
create index if not exists feed_entries_user_time_idx on feed_entries (user_id, published_at desc);
create index if not exists feed_entries_unread_idx on feed_entries (user_id, published_at desc) where read_at is null and saved_item_id is null;

alter table feeds enable row level security;
alter table feed_entries enable row level security;
do $$ begin create policy feeds_select on feeds for select using (auth.uid() = user_id); exception when duplicate_object then null; end $$;
do $$ begin create policy entries_select on feed_entries for select using (auth.uid() = user_id); exception when duplicate_object then null; end $$;
-- Writes go through the API/worker with the service role (feed URLs must pass the SSRF guard first).
revoke insert, update, delete on feeds, feed_entries from anon, authenticated;

-- Lease due feeds. FOR UPDATE SKIP LOCKED => any number of workers can run concurrently.
create or replace function claim_due_feeds(p_limit int default 10, p_lease_sec int default 300)
returns setof feeds language sql security definer set search_path = public as $$
  update feeds f set leased_until = now() + make_interval(secs => p_lease_sec)
  where f.id in (
    select id from feeds
    where status = 'active' and next_fetch_at <= now() and (leased_until is null or leased_until < now())
    order by next_fetch_at limit greatest(1, least(p_limit, 50))
    for update skip locked)
  returning f.*;
$$;
revoke all on function claim_due_feeds(int, int) from public, anon, authenticated;
grant execute on function claim_due_feeds(int, int) to service_role;
