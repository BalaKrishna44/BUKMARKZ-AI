'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { hashInviteToken, INVITE_TOKEN_RE } from '@/lib/shares/invite';

export type AcceptState = { ok: false; error: 'invalid' | 'wrong_account' | 'seat_limit' | 'unverified' | 'failed' } | null;

/** POST from /invite/team/[token]. A POST (not a GET) so mail scanners that pre-fetch links cannot accept for you. */
export async function acceptTeamShare(_prev: AcceptState, formData: FormData): Promise<AcceptState> {
  const token = String(formData.get('token') ?? '');
  if (!INVITE_TOKEN_RE.test(token)) return { ok: false, error: 'invalid' };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/team/${token}`)}`);
  if (!user.email_confirmed_at) return { ok: false, error: 'unverified' };            // the invite is bound to an email address: it must be a verified one

  const { data, error } = await createAdminClient().rpc('team_share_accept', { p_user: user.id, p_token_hash: hashInviteToken(token) });
  if (error) {
    if (/wrong_account/.test(error.message)) return { ok: false, error: 'wrong_account' };
    if (/seat_limit/.test(error.message)) return { ok: false, error: 'seat_limit' };
    return { ok: false, error: /invalid_invite/.test(error.message) ? 'invalid' : 'failed' };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { org_slug: string } | undefined;
  redirect(`/dashboard?workspace=${encodeURIComponent(row?.org_slug ?? '')}`);        // redirect() throws: keep it outside try/catch
}
