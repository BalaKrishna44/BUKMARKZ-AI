-- Stand-ins for what the production database already has before 017 (test only): pgvector, items table, RLS.
create schema if not exists extensions;
create domain vector as float8[];
create function _cos(a float8[], b float8[]) returns float8 language sql immutable as
$$ select 1 - (select sum(x*y) from unnest(a, b) t(x, y)) / (sqrt((select sum(x*x) from unnest(a) x)) * sqrt((select sum(y*y) from unnest(b) y))) $$;
create operator <=> (leftarg = float8[], rightarg = float8[], function = _cos);
alter table auth.users add column if not exists email text;
create table oneclist_items (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  url text not null, url_key text not null, title text not null default '', summary text, note text, tags text[] not null default '{}', ai_tags text[], category_id uuid,
  source text, status text not null default 'bookmark', ai_status text not null default 'none', is_private boolean not null default false,
  embedding vector, embedding_model text, created_at timestamptz not null default now(),
  fts tsvector generated always as (setweight(to_tsvector('english', coalesce(title,'')), 'A') || setweight(to_tsvector('english', coalesce(summary,'')), 'B') || setweight(to_tsvector('english', coalesce(note,'')), 'B')) stored
);
create unique index oneclist_items_user_urlkey_uq on oneclist_items(user_id, url_key);
alter table oneclist_items enable row level security;
create policy items_own on oneclist_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on oneclist_items to authenticated;
