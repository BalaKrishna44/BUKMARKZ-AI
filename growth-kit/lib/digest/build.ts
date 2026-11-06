import { createHmac, timingSafeEqual } from 'node:crypto';

export interface DigestItem { id: string; title: string; url: string; created_at: string }
export const MIN_DIGEST_ITEMS = 3;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const clip = (s: string, n: number) => { const x = s.replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n - 1).trimEnd() + '…' : x; };
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
export function monthsAgo(iso: string, now = new Date()): string {
  const d = (+now - +new Date(iso)) / 86_400_000;
  if (d < 30) return `${Math.max(1, Math.round(d / 7))} weeks ago`;
  const m = Math.round(d / 30); return m <= 1 ? '1 month ago' : m < 12 ? `${m} months ago` : `${Math.round(m / 12)} year${Math.round(m / 12) === 1 ? '' : 's'} ago`;
}

/* Signed one-click unsubscribe: HMAC(secret, "digest:<user id>"). No secret => no email (we never send mail we cannot opt out of). */
const secret = () => process.env.ALERT_SIGNING_SECRET ?? '';
export const signingConfigured = () => secret().length >= 16;
export const signUser = (uid: string) => createHmac('sha256', secret()).update(`digest:${uid}`).digest('hex');
export function verifyUserToken(uid: string, token: string): boolean {
  if (!signingConfigured() || !/^[0-9a-f]{64}$/.test(token)) return false;
  const a = Buffer.from(signUser(uid), 'hex'), b = Buffer.from(token, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
export const unsubscribeUrl = (site: string, uid: string) => `${site}/api/digest/unsubscribe?u=${encodeURIComponent(uid)}&t=${signUser(uid)}`;

/** Returns null when there is not enough to say (we never send a thin, spammy email). */
export function buildDigest(items: DigestItem[], site: string, unsub: string, now = new Date()) {
  if (items.length < MIN_DIGEST_ITEMS) return null;
  const rows = items.slice(0, 5).map((i) => {
    const title = clip(i.title || i.url, 100) || i.url;
    return { title, host: host(i.url), age: monthsAgo(i.created_at, now), open: `${site}/dashboard?item=${encodeURIComponent(i.id)}` };
  });
  const subject = `${rows.length} links you saved and forgot`;
  const text = [`A few things you saved a while ago:`, '', ...rows.map((r) => `- ${r.title} (${r.host}, saved ${r.age})\n  ${r.open}`), '',
    `Quiz yourself on them: ${site}/dashboard?resurface=1`, '', `You get this once a week. Stop it: ${unsub}`, ''].join('\n');
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px;line-height:1.5;color:#0f172a"><h2 style="margin:0 0 8px">${esc(subject)}</h2>`
    + `<p>A few things you saved a while ago:</p><ul style="padding-left:18px">`
    + rows.map((r) => `<li style="margin:8px 0"><a href="${esc(r.open)}">${esc(r.title)}</a><br><span style="color:#64748b;font-size:13px">${esc(r.host)} · saved ${esc(r.age)}</span></li>`).join('')
    + `</ul><p><a href="${esc(site)}/dashboard?resurface=1">Quiz yourself on them</a></p>`
    + `<p style="color:#64748b;font-size:12px">You get this once a week because you turned it on. <a href="${esc(unsub)}">Stop it</a></p></div>`;
  return { subject, text, html, ids: items.slice(0, 5).map((i) => i.id) };
}
