import { createHash, randomBytes } from 'node:crypto';

/** Pure helpers for "tag a colleague" invites: validation, secret tokens, the display name, and the email itself. */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Pragmatic ASCII address check (no IDN / quoted locals). The database re-checks a looser form; the real proof is the invitee clicking the link.
const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) && !e.includes('..') ? e : null;
}

/** 256-bit secret for the invite link. Only its sha256 is stored, so a database leak cannot be used to join a workspace. */
export const newInviteToken = () => randomBytes(32).toString('base64url');
export const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const hashInviteToken = (t: string) => createHash('sha256').update(t).digest('hex');

/**
 * The name shown in the subject line ("Sarah invited you…"). It comes from a profile field the inviter controls, so it is the main phishing lever:
 * keep letters, marks, spaces, apostrophes and hyphens only (no dots: "evil.test" would auto-link), cap the length, and fall back to the local part of their email.
 */
export function displayName(meta: { full_name?: unknown; name?: unknown } | null | undefined, email: string | null | undefined): string {
  const raw = [meta?.full_name, meta?.name].find((v): v is string => typeof v === 'string' && v.trim().length > 0) ?? '';
  const clean = raw.normalize('NFKC').replace(/[^\p{L}\p{M} '’-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (/\p{L}/u.test(clean)) return clean;
  const local = (email ?? '').split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 30);
  return local || 'A colleague';
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const oneLine = (s: string, n: number) => { const t = s.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

export interface InviteEmailInput { inviterName: string; inviterEmail: string; workspace: string; itemTitle: string; itemHost: string; acceptUrl: string }
export function buildInviteEmail(i: InviteEmailInput) {
  const who = oneLine(i.inviterName, 40), ws = oneLine(i.workspace, 60), title = oneLine(i.itemTitle, 100) || i.itemHost, host = oneLine(i.itemHost, 80);
  const subject = `${who} invited you to view a research stack on Bukmarkz`;
  const text = `${who} (${i.inviterEmail}) invited you to view a research stack in the "${ws}" workspace on Bukmarkz.\n\nFirst item: ${title} (${host})\n\nAccept the invite: ${i.acceptUrl}\n\n`
    + `You will join as a viewer: you can read what the workspace shares, nothing in your own account changes, and nobody sees your personal bookmarks.\n`
    + `Not expecting this? Ignore this email. Nothing happens unless you accept, and the link expires in 14 days.\n`;
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;line-height:1.55;color:#0f172a">`
    + `<h2 style="margin:0 0 12px;font-size:20px">${esc(who)} invited you to view a research stack on Bukmarkz</h2>`
    + `<p style="margin:0 0 4px"><strong>${esc(who)}</strong> (${esc(i.inviterEmail)}) shared items from the <strong>${esc(ws)}</strong> workspace with you.</p>`
    + `<p style="margin:0 0 16px;color:#475569">First item: ${esc(title)} <span style="color:#94a3b8">· ${esc(host)}</span></p>`
    + `<p style="margin:0 0 20px"><a href="${esc(i.acceptUrl)}" style="background:#0f172a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">View the stack</a></p>`
    + `<p style="margin:0;color:#64748b;font-size:12px">You join as a viewer. Your own bookmarks stay private. Not expecting this? Ignore this email: nothing happens unless you accept, and the link expires in 14 days.</p></div>`;
  return { subject, text, html };
}
