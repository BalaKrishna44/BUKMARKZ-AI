// Pure helpers (no Deno/Node-only APIs) so they can be unit-tested outside the edge runtime.
export interface PickedItem { id: string; title: string; url: string; created_at: string; summary: string | null }
export interface DigestRowData { id: string; title: string; host: string; age: string; recap: string; href: string }
export const MIN_ITEMS = 3;
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const clip = (s: string, n: number) => { const x = s.replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n - 1).trimEnd() + '…' : x; };
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

export function ageLabel(iso: string, now = new Date()): string {
  const d = (+now - +new Date(iso)) / 86_400_000;
  if (d < 30) return `${Math.max(2, Math.round(d / 7))} weeks ago`;
  const m = Math.round(d / 30);
  return m <= 1 ? '1 month ago' : m < 12 ? `${m} months ago` : `${Math.round(m / 12)} year${Math.round(m / 12) === 1 ? '' : 's'} ago`;
}

/** Buk's one-sentence recap = first sentence of the summary the AI already wrote at save time. No new LLM call, so no new cost. */
export function recapOf(summary: string | null | undefined, title: string): string {
  const s = (summary ?? '').replace(/\s+/g, ' ').trim();
  if (s) { const m = s.match(/^.+?[.!?](?=\s|$)/); return clip(m ? m[0] : s, 160); }
  return `You saved this as "${clip(title, 60)}". Worth another look?`;
}

export function isoWeek(d = new Date()): number {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day); const y0 = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((+t - y0) / 86_400_000 + 1) / 7);
}

export function toRows(items: PickedItem[], site: string, now = new Date()): DigestRowData[] {
  return items.slice(0, 5).map((i) => ({
    id: i.id, title: clip(i.title || i.url, 100) || i.url, host: host(i.url), age: ageLabel(i.created_at, now),
    recap: recapOf(i.summary, i.title || i.url), href: `${site}/dashboard?item=${encodeURIComponent(i.id)}`,
  }));
}

export function plainText(rows: DigestRowData[], quizUrl: string, unsub: string): string {
  return ['Buk here. You saved these and never came back:', '', ...rows.map((r, n) => `${n + 1}. ${r.title} (${r.host}, saved ${r.age})\n   Buk: ${r.recap}\n   ${r.href}`), '',
    `Open Vault & Take Recall Quiz: ${quizUrl}`, '', `You get this once a week. Unsubscribe: ${unsub}`, ''].join('\n');
}

/** Same signature as growth-kit/lib/digest/build.ts signUser(), so the existing /api/digest/unsubscribe route accepts these links. */
export async function signUser(uid: string, secret: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`digest:${uid}`)));
}
export async function unsubscribeUrl(site: string, uid: string, secret: string) {
  return `${site}/api/digest/unsubscribe?u=${encodeURIComponent(uid)}&t=${await signUser(uid, secret)}`;
}
/** Constant-time compare of the cron bearer. */
export function bearerOk(header: string | null, secret: string): boolean {
  if (!secret || secret.length < 16 || !header?.startsWith('Bearer ')) return false;
  const a = new TextEncoder().encode(header.slice(7)), b = new TextEncoder().encode(secret);
  let diff = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
