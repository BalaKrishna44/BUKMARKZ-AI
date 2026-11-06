import { buildInviteEmail, hashInviteToken, newInviteToken, normalizeEmail, UUID_RE } from './invite';

/**
 * tagColleague core. All I/O comes in through `deps` so it is testable without Supabase or Resend (see test/shares.test.ts).
 *
 * Security properties:
 *  - the inviter is the verified session user (`deps.user`), never a form field;
 *  - the database function re-checks ownership, role, privacy, seat limit and rate limit (027_team_shares.sql);
 *  - the reply never says whether the address already has a Bukmarkz account, or is already a member;
 *  - a failed email undoes the share (and moves the item back if this call moved it).
 */
export type TagError = 'signin' | 'invalid_item' | 'invalid_email' | 'not_found' | 'private' | 'forbidden' | 'choose_workspace' | 'seat_limit' | 'rate_limited' | 'email_failed' | 'failed';
export type TagResult = { ok: true } | { ok: false; error: TagError };

export interface CreateRow { share_id: string | null; org_id: string; org_name: string; outcome: 'created' | 'resent' | 'duplicate' | 'member'; send_count: number; moved: boolean }
export interface TagDeps {
  user: { id: string; email: string | null; emailConfirmed: boolean; name: string } | null;
  createShare(a: { actor: string; item: string; org: string | null; email: string; tokenHash: string }): Promise<{ row?: CreateRow; error?: string }>;
  unsend(a: { actor: string; share: string; wasNew: boolean; moved: boolean }): Promise<void>;
  item(id: string, actor: string): Promise<{ title: string; url: string } | null>;
  send(m: { to: string; subject: string; text: string; html: string; idempotencyKey: string }): Promise<boolean>;
  siteUrl: string;
}

const MAP: [RegExp, TagError][] = [
  [/item_not_found/, 'not_found'], [/private_item/, 'private'], [/invalid_email/, 'invalid_email'], [/org_required/, 'choose_workspace'],
  [/item_in_other_workspace|forbidden|42501/, 'forbidden'], [/seat_limit/, 'seat_limit'], [/rate_limited/, 'rate_limited'],
];
export const mapDbError = (m: string): TagError => MAP.find(([re]) => re.test(m))?.[1] ?? 'failed';

export async function tagColleague(deps: TagDeps, input: { itemId: unknown; email: unknown; orgId?: unknown }): Promise<TagResult> {
  const u = deps.user;
  if (!u) return { ok: false, error: 'signin' };
  if (typeof input.itemId !== 'string' || !UUID_RE.test(input.itemId)) return { ok: false, error: 'invalid_item' };
  const org = input.orgId == null || input.orgId === '' ? null : (typeof input.orgId === 'string' && UUID_RE.test(input.orgId) ? input.orgId : undefined);
  if (org === undefined) return { ok: false, error: 'invalid_item' };
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, error: 'invalid_email' };
  if (!u.emailConfirmed) return { ok: false, error: 'forbidden' };                    // unverified accounts cannot make us send mail

  const token = newInviteToken();
  const { row, error } = await deps.createShare({ actor: u.id, item: input.itemId, org, email, tokenHash: hashInviteToken(token) });
  if (error || !row) return { ok: false, error: mapDbError(error ?? '') };
  if (row.outcome === 'member' || row.outcome === 'duplicate' || !row.share_id) return { ok: true };   // nothing new to say, and nothing to reveal

  const item = await deps.item(input.itemId, u.id);
  let host = 'a saved page'; try { if (item) host = new URL(item.url).hostname; } catch { /* keep default */ }
  const mail = buildInviteEmail({
    inviterName: u.name, inviterEmail: u.email ?? '', workspace: row.org_name, itemTitle: item?.title ?? '', itemHost: host,
    acceptUrl: `${deps.siteUrl.replace(/\/$/, '')}/invite/team/${token}`,
  });
  let sent = false;
  try { sent = await deps.send({ to: email, ...mail, idempotencyKey: `team-share-${row.share_id}-${row.send_count}` }); } catch { sent = false; }
  if (!sent) {
    try { await deps.unsend({ actor: u.id, share: row.share_id, wasNew: row.outcome === 'created', moved: row.moved }); } catch { /* the 10-minute window and 14-day expiry still bound a stranded row */ }
    return { ok: false, error: 'email_failed' };
  }
  return { ok: true };
}
