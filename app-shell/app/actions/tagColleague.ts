'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { displayName } from '@/lib/shares/invite';
import { tagColleague as run, type TagDeps, type TagResult, type CreateRow } from '@/lib/shares/tag';

/**
 * "Tag a colleague" on a saved item: `<form action={tagColleagueAction}>` with fields itemId, email and (only when you belong to several workspaces) orgId.
 *
 *   1. identity = the verified session user (getUser validates the JWT with Supabase);
 *   2. team_share_create() (service role, 027_team_shares.sql) checks you own the item and are an editor+ of the workspace, links the item to the workspace
 *      (oneclist_items.org_id), and records the pending share with only the SHA-256 of the invite secret;
 *   3. Resend delivers "<Name> invited you to view a research stack on Bukmarkz" with a link to /invite/team/<secret>;
 *   4. if delivery fails the share is undone.
 * Env: RESEND_API_KEY, TEAM_INVITES_FROM ("Bukmarkz <team@bukmarkz.com>"), NEXT_PUBLIC_SITE_URL.
 */
export type TagState = TagResult | null;

export async function tagColleagueAction(_prev: TagState, formData: FormData): Promise<TagResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const db = createAdminClient();

  const deps: TagDeps = {
    user: user ? { id: user.id, email: user.email ?? null, emailConfirmed: Boolean(user.email_confirmed_at), name: displayName(user.user_metadata, user.email) } : null,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'https://bukmarkz.com',
    async createShare(a) {
      const { data, error } = await db.rpc('team_share_create', { p_actor: a.actor, p_item: a.item, p_org: a.org, p_email: a.email, p_token_hash: a.tokenHash });
      if (error) return { error: `${error.message} ${error.code ?? ''}` };
      const row = (Array.isArray(data) ? data[0] : data) as CreateRow | undefined;
      return row ? { row } : { error: 'empty' };
    },
    async unsend(a) { await db.rpc('team_share_unsend', { p_actor: a.actor, p_share: a.share, p_was_new: a.wasNew, p_moved: a.moved }); },
    async item(id, actor) {
      const { data } = await db.from('oneclist_items').select('title,url').eq('id', id).eq('user_id', actor).maybeSingle();
      return data ? { title: String(data.title ?? ''), url: String(data.url ?? '') } : null;
    },
    async send(m) {
      const key = process.env.RESEND_API_KEY, from = process.env.TEAM_INVITES_FROM;
      if (!key || !from) return false;                                                // not configured: fail closed, the share is rolled back
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(8000),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'idempotency-key': m.idempotencyKey },
        body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
      });
      return res.ok;
    },
  };
  return run(deps, { itemId: formData.get('itemId'), email: formData.get('email'), orgId: formData.get('orgId') });
}
