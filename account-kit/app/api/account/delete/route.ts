import { admin, json, requireUser } from '@/lib/server';
import { confirmationOk, recentlySignedIn, sameOriginOnly } from '@/lib/account/core';
import { eraseR2Files, eraseSupabaseFiles } from '@/lib/account/erase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST { "confirm": "DELETE", "email": "<your email>" }  Permanently erase the signed-in account.
 * Guards: own-site cookie session only (no Bearer tokens), JSON only, signed in within the last 30 minutes, typed confirmation.
 * Order: database rows (erase_user_data) -> files (Supabase Storage, R2) -> login (auth user). Every step is safe to repeat, so if one fails the
 * user can press the button again; the login is removed LAST so they can still sign in to retry.
 */
export async function POST(req: Request) {
  if (!sameOriginOnly(req)) return json({ error: 'forbidden' }, 403);
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return json({ error: 'expected_json' }, 415);
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (!recentlySignedIn(user.last_sign_in_at)) return json({ error: 'reauth_required' }, 403);
  let body: unknown; try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
  if (!confirmationOk(body, user.email)) return json({ error: 'confirmation_mismatch' }, 400);

  const erased = await admin.rpc('erase_user_data', { p_user: user.id });
  if (erased.error) {
    if (/org_owner_blocked/.test(erased.error.message)) return json({ error: 'org_owner_blocked' }, 409);
    console.error('erase_user_data failed');
    return json({ error: 'erase_failed' }, 500);
  }
  let files = 0;
  try { files = (await eraseSupabaseFiles(user.id)) + (await eraseR2Files(user.id)); }
  catch { console.error('file erase failed'); return json({ error: 'files_failed' }, 500); }
  const gone = await admin.auth.admin.deleteUser(user.id);
  if (gone.error) { console.error('auth delete failed'); return json({ error: 'auth_delete_failed' }, 500); }
  console.log(JSON.stringify({ event: 'account_erased', rows: (erased.data as { rows?: number } | null)?.rows ?? 0, files }));    // counts only, no identifiers
  return json({ ok: true });
}
