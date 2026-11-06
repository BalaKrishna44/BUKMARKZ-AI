'use server';

import { createClient } from '@/lib/supabase/server';
import { saveSessionCore, SESSION_URL, type SaveOutcome } from '@/lib/sessions/core';
import { sessionDeps } from '@/lib/sessions/deps';

/**
 * Server Action for the web app (cookie session): saves a set of tabs as a Focus Session Stack and returns bukmarkz.com/s/<session_id>.
 * The browser extension cannot call a Server Action (no cookies, no action id), so it posts to /api/vault/session, which runs the same core.
 *
 *   const r = await saveSession({ tabs: [{ url, title, favicon }], title?: 'Postgres pooling research' });
 *   if (r.ok) copy(r.url)
 *
 * What happens: validate and clean the tabs, insert one `sessions` row as the signed-in user (RLS), return the link at once, then (after the reply) ask Claude Haiku,
 * through the per-user cost circuit breaker, for a 1-2 sentence summary and attach it. A failed or over-budget summary never fails the save.
 */
export async function saveSession(input: { tabs: { url: string; title?: string; favicon?: string | null }[]; title?: string }): Promise<SaveOutcome> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'failed' };
  return saveSessionCore(sessionDeps(supabase as never, user.id), user.id, input);
}

/** Turn link sharing on or off. RLS limits the update to the owner's own row. */
export async function setSessionShared(id: string, shared: boolean): Promise<{ ok: boolean; url?: string }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return { ok: false };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  const { data, error } = await supabase.from('sessions').update({ shared: Boolean(shared) }).eq('id', id).eq('user_id', user.id).select('id').maybeSingle();
  if (error || !data) return { ok: false };
  return { ok: true, url: SESSION_URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://bukmarkz.com', id) };
}
