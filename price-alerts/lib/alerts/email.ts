import { money, type Alert } from './notify';
import { signingConfigured, unsubscribeUrl } from './token';

/** Resend. https://resend.com/docs/api-reference/emails/send-email  Env: RESEND_API_KEY, ALERTS_FROM ("Bukmarkz <alerts@bukmarkz.com>"), ALERT_SIGNING_SECRET. */
const SITE = () => (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://bukmarkz.com').replace(/\/$/, '');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function buildEmail(a: Alert) {
  const c = a.claim, title = clip((c.title ?? '').replace(/\s+/g, ' ').trim() || 'A product you are watching', 120);
  const price = money(a.price, c.currency), target = money(Number(c.target_price), c.currency);
  const median = a.medianPrice ? money(a.medianPrice, c.currency) : null;
  const unsub = unsubscribeUrl(SITE(), c.watch_id), open = `${SITE()}/dashboard?item=${encodeURIComponent(c.item_id)}`;
  const line = `${title} is now ${price}, at or under your target of ${target}.${median ? ` The usual price over the last 90 days is about ${median}.` : ''}`;
  const text = `${line}\n\nOpen it in Bukmarkz: ${open}\nThe page you saved: ${c.url}\n\nYou get at most one alert per product every 7 days.\nStop alerts for this product: ${unsub}\n`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px;line-height:1.5;color:#0f172a"><h2 style="margin:0 0 8px">Price drop: ${esc(title)}</h2><p>${esc(line)}</p>`
    + `<p><a href="${esc(open)}">Open it in Bukmarkz</a> · <a href="${esc(c.url)}">The page you saved</a></p>`
    + `<p style="color:#64748b;font-size:12px">You get at most one alert per product every 7 days. <a href="${esc(unsub)}">Stop alerts for this product</a></p></div>`;
  return { subject: `Price drop: ${clip(title, 70)} is now ${price}`, text, html, unsub };
}

export async function sendEmail(a: Alert, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const key = process.env.RESEND_API_KEY, from = process.env.ALERTS_FROM, to = a.claim.email;
  if (!key || !from || !to || !signingConfigured()) return false;                      // no unsubscribe link possible -> no email
  const m = buildEmail(a);
  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(6000),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'idempotency-key': `price-${a.claim.watch_id}-${Math.floor(Date.now() / 3_600_000)}` },
    body: JSON.stringify({ from, to: [to], subject: m.subject, text: m.text, html: m.html, headers: { 'List-Unsubscribe': `<${m.unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }),
  });
  return res.ok;
}
