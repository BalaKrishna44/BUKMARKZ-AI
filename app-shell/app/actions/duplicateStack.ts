'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getPublicStack } from '@/lib/stacks/public';
import { validSlug } from '@/lib/stacks/slug';
import { SIGNUP_PATH } from './remix-constants';

/**
 * "Duplicate Stack to My Vault" on a public portfolio page (/<handle>/<slug>).
 *
 * Copy = the `fork_stack` SQL function (dash/sql/010_stacks.sql): ONE INSERT ... SELECT into the caller's own oneclist_items,
 * tagged `stack-<slug>`, URLs they already have are skipped, fork_count goes up once per user. It runs as the signed-in user:
 * auth.uid() comes from the session cookie, so there is no user_id argument to forge. Only public, non-blocked stacks can be copied.
 *
 * The page the visitor sees is only used for the "come back here" link, and it is rebuilt from the database (the stack's real handle),
 * never from form input, so a tampered form cannot produce an open redirect.
 */
export type DuplicateState = { ok: false; error: 'invalid' | 'not_found' | 'failed' } | null;

export async function duplicateStack(_prev: DuplicateState, formData: FormData): Promise<DuplicateState> {
  const slug = String(formData.get('slug') ?? '').toLowerCase();
  if (!validSlug(slug)) return { ok: false, error: 'invalid' };

  const stack = await getPublicStack(slug);                                  // cached anonymous read; null = missing / private / blocked
  if (!stack) return { ok: false, error: 'not_found' };
  const back = `/${stack.handle}/${stack.slug}`;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();                // verified with Supabase, not just decoded from the cookie
  if (!user) redirect(`${SIGNUP_PATH}?next=${encodeURIComponent(back)}`);   // SIGNUP_PATH: '/signup' today; change the constant if your route is '/register'

  const { data, error } = await supabase.rpc('fork_stack', { p_slug: stack.slug });
  if (error) {
    console.error('fork_stack failed', error.code);                          // never log payloads
    return { ok: false, error: /not_found/.test(error.message) ? 'not_found' : 'failed' };
  }
  redirect(`/dashboard?forked=${encodeURIComponent(stack.slug)}&added=${Number(data) || 0}`);   // redirect() throws: keep it outside any try/catch
}
