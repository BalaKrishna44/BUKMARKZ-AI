-- Run in the Supabase SQL editor.
create table if not exists public.bookmarks (
  id         uuid primary key,                       -- created on the phone: makes retries safe
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  url        text,
  note       text,
  source     text,                                   -- 'android-share', 'ios-share', ...
  created_at timestamptz not null default now(),
  constraint bookmarks_url_is_web check (url is null or url ~* '^https?://'),   -- no javascript: links
  constraint bookmarks_has_content check (url is not null or note is not null),
  constraint bookmarks_sizes check (char_length(coalesce(url, '')) <= 2048 and char_length(coalesce(note, '')) <= 2000)
);

-- Saving the same link twice is a no-op for the app (it treats error 23505 as "already saved").
create unique index if not exists bookmarks_user_url_key on public.bookmarks (user_id, url);

alter table public.bookmarks enable row level security;

create policy "read own bookmarks" on public.bookmarks
  for select to authenticated using (user_id = (select auth.uid()));

create policy "add own bookmarks" on public.bookmarks
  for insert to authenticated with check (user_id = (select auth.uid()));
