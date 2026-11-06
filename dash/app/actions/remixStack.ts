'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { validSlug } from '@/lib/stacks/slug';

/**
 * "Remix into my vault": copies every link of a PUBLIC stack into the caller's own bookmarks (oneclist_items), tagged
 * `stack-<slug>`, in ONE database call. The copy is the `fork_stack` SQL function (dash/sql/010_stacks.sql): a single
 * INSERT ... SELECT inside one transaction, existing URLs skipped (ON CONFLICT DO NOTHING), fork_count bumped once per user.
 *
 * Security:
 *  - The user is NEVER taken from the client. `fork_stack` reads auth.uid() from the session cookie, so nobody can pass
 *    someone else's user_id (that would be an IDOR). There is deliberately no user_id argument.
 *  - The stack is addressed by its public slug: stacks are not readable by anon/authenticated roles directly (the public
 *    reads through get_public_stack), and fork_stack only accepts is_public AND NOT is_blocked stacks.
 */

export const SIGNUP_PATH = '/signup';            // change to '/register' if that is your sign-up route
export const INTENT_COOKIE = 'bukmarkz_remix_intent';
const INTENT_TTL_S = 30 * 60;

export type RemixState = { ok: false; error: 'invalid' | 'not_found' | 'failed' } | null;

const resumePath = (slug: string) => `/s/${slug}/fork?action=remix`;

/** Form action: `<form action={remixStack}><input type="hidden" name="slug" .../></form>` (works with useActionState). */
export async function remixStack(_prev: RemixState, formData: FormData): Promise<RemixState> {
  const slug = String(formData.get('slug') ?? '').toLowerCase();
  if (!validSlug(slug)) return { ok: false, error: 'invalid' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();                // verifies the JWT with Supabase (getSession would only decode the cookie)

  if (!user) {
    // Remember that THIS browser asked for the remix, then send them to sign up. After sign-up they land on the fork page,
    // which auto-runs the remix only if this cookie is present (see resumeRemix). A link on another site can't set it.
    const jar = await cookies();
    jar.set(INTENT_COOKIE, slug, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: INTENT_TTL_S });
    redirect(`${SIGNUP_PATH}?next=${encodeURIComponent(resumePath(slug))}&action=remix`);
  }

  return runFork(supabase, slug);
}

/** Called by <AutoRemix/> after sign-up/sign-in. Runs only when the intent cookie matches the stack in the URL. */
export async function resumeRemix(slug: string): Promise<RemixState> {
  slug = String(slug ?? '').toLowerCase();
  const jar = await cookies();
  if (!validSlug(slug) || jar.get(INTENT_COOKIE)?.value !== slug) return { ok: false, error: 'invalid' };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(resumePath(slug))}`);
  jar.delete(INTENT_COOKIE);                                                // single use
  return runFork(supabase, slug);
}

async function runFork(supabase: Awaited<ReturnType<typeof createClient>>, slug: string): Promise<RemixState> {
  const { data, error } = await supabase.rpc('fork_stack', { p_slug: slug });
  if (error) {
    console.error('fork_stack failed', error.code);                          // never log payloads
    return { ok: false, error: /not_found/.test(error.message) ? 'not_found' : 'failed' };
  }
  redirect(`/dashboard?forked=${encodeURIComponent(slug)}&added=${Number(data) || 0}`);   // redirect() throws: keep it outside any try/catch
}
