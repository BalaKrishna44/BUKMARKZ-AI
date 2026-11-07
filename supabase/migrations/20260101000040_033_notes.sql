-- Notes: private, OneNote-style notebooks and notes. Owner-only via RLS.
create table if not exists public.notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  notebook   text not null default 'General',
  title      text not null default '',
  body       text not null default '',
  pinned     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notes_notebook_len check (char_length(notebook) between 1 and 60),
  constraint notes_title_len check (char_length(title) <= 300),
  constraint notes_body_len check (char_length(body) <= 200000)
);
create index if not exists notes_user_updated_idx on public.notes (user_id, updated_at desc);
create index if not exists notes_user_notebook_idx on public.notes (user_id, notebook);

alter table public.notes enable row level security;
do $$ begin
  create policy notes_own on public.notes for all to authenticated
    using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

create or replace function public.notes_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists notes_touch on public.notes;
create trigger notes_touch before update on public.notes for each row execute function public.notes_touch();
