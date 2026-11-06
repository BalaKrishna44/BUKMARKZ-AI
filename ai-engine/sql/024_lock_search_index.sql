-- 024: lock down the AI search index and reminder tables.
--
-- Problem: 001_ai_features.sql created bookmark_chunks, reminder_queue and notification_prefs with NO row level security and no
-- revoked grants. On Supabase, `anon` and `authenticated` get table privileges by default, so anyone holding the public anon key
-- could read every non-private chunk of every user through the REST API. search_chunks() trusted a caller-supplied p_user_id and
-- was executable by everyone, so a signed-in user could search another user's vault.
--
-- Fix: RLS on, no client access to the index or the queue, owner-only access to notification prefs, and the two helper functions
-- callable only by service_role (the ai-engine worker connects with DATABASE_URL as the table owner, which is unaffected).
-- Safe to re-run.

alter table bookmark_chunks      enable row level security;
alter table reminder_queue       enable row level security;
alter table notification_prefs   enable row level security;

revoke all on bookmark_chunks, reminder_queue, notification_prefs from anon, authenticated;

-- The search index and the queue are server-only: no policies for clients means no rows for clients, even if a grant comes back later.
-- Notification prefs are the one thing a user edits themselves.
grant all on bookmark_chunks, reminder_queue, notification_prefs to service_role;     -- explicit, in case default privileges were changed
grant select, insert, update on notification_prefs to authenticated;
drop policy if exists notification_prefs_owner on notification_prefs;
create policy notification_prefs_owner on notification_prefs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Functions that take a user id must never be callable with someone else's.
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('search_chunks', 'mark_bookmark_opened', 'sync_chunk_flags') loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
