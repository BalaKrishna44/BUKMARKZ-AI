-- 007: live dashboard. Run after 001, 002, 004, 005. Idempotent.

-- 1. Task completion. Tasks are rows with item_type = 'oneclist_task' (set by 002); completed_at is null while open.
alter table public.oneclist_items add column if not exists completed_at timestamptz;
create index if not exists oneclist_items_open_tasks_idx on public.oneclist_items (user_id, created_at desc)
  where item_type = 'oneclist_task' and completed_at is null;

-- 2. Realtime. The dashboard subscribes to INSERT/UPDATE/DELETE on the user's own rows (RLS decides who receives what).
do $$ begin alter publication supabase_realtime add table public.oneclist_items;
exception when duplicate_object then null; when undefined_object then raise notice 'publication supabase_realtime not found: enable Realtime in the Supabase dashboard'; end $$;
do $$ begin alter publication supabase_realtime add table public.categories;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- 3. The dashboard updates only these columns; RLS (items_own from 001) already limits every statement to the owner.
-- Nothing to grant: authenticated users keep the table rights they already have.
