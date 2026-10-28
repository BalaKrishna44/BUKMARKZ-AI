type ParsedBookmark = any;

const MAX_URL = 2048, MAX_TITLE = 500, MAX_NOTE = 10_000, MAX_TAGS = 20, MAX_TAG_LEN = 50;
const MAX_FOLDER_DEPTH = 10, MAX_FOLDER_LEN = 100;
const TRACKING = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_eid|igshid|ref_src)$/i;

export type UrlCheck = { ok: true; url: string; key: string } | { ok: false; reason: string };

/** Only http(s) is importable. javascript:, data:, file:, place:, about: etc. are rejected. */
export function checkUrl(raw: unknown): UrlCheck {
  if (typeof raw !== 'string') return { ok: false, reason: 'missing-url' };
  const s = raw.trim();
  if (!s) return { ok: false, reason: 'missing-url' };
  if (s.length > MAX_URL) return { ok: false, reason: 'url-too-long' };
  let u: URL;
  try { u = new URL(s); } catch { return { ok: false, reason: 'invalid-url' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'unsupported-scheme' };
  if (u.username || u.password) return { ok: false, reason: 'credentials-in-url' };
  return { ok: true, url: s, key: urlKey(u) };
}

/** Same page, different spelling => same key (host case, www., #fragment, tracking params, trailing slash). */
export function urlKey(u: URL): string {
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const port = u.port && !((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) ? ':' + u.port : '';
  const path = u.pathname.replace(/\/+$/, '') || '';
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const qs = params.length ? '?' + params.map(([k, v]) => `${k}=${v}`).join('&') : '';
  return `${host}${port}${path}${qs}`;
}

export function cleanText(v: unknown, max: number): string {
  // strip control chars (keep \n and \t), collapse nothing else
  return (typeof v === 'string' ? v : '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

export function normalizeTag(t: string): string {
  return t.trim().replace(/^#+/, '').toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_\-./+]/gu, '').slice(0, MAX_TAG_LEN);
}

export function normalizeTags(list: string[]): string[] {
  const out = new Set<string>();
  for (const t of list) { const n = normalizeTag(t); if (n) out.add(n); if (out.size >= MAX_TAGS) break; }
  return [...out];
}

export function normalizeFolder(path: string[]): string[] {
  return path.map((p) => cleanText(p, MAX_FOLDER_LEN).replace(/\s+/g, ' ')).filter(Boolean).slice(0, MAX_FOLDER_DEPTH);
}

/** Accepts unix seconds / ms / µs, numeric strings, or date strings. Returns ISO or null. */
export function toIsoDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  let ms: number;
  if (typeof v === 'number' || /^\d+(\.\d+)?$/.test(String(v).trim())) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    ms = n > 1e14 ? n / 1000 : n > 1e11 ? n : n * 1000; // µs | ms | s
  } else {
    ms = Date.parse(String(v));
  }
  if (!Number.isFinite(ms)) return null;
  const min = Date.UTC(1990, 0, 1), max = Date.now() + 86_400_000;
  if (ms < min || ms > max) return null;
  return new Date(ms).toISOString();
}

export function buildBookmark(input: {
  url: unknown; title?: unknown; note?: unknown; tags?: string[]; folder?: string[]; created?: unknown;
}): { ok: true; item: ParsedBookmark } | { ok: false; reason: string } {
  const c = checkUrl(input.url);
  if (!c.ok) return c;
  const title = cleanText(input.title, MAX_TITLE) || new URL(c.url).hostname;
  const note = cleanText(input.note, MAX_NOTE) || null;
  return {
    ok: true,
    item: {
      url: c.url, urlKey: c.key, title, note,
      tags: normalizeTags(input.tags ?? []),
      folder: normalizeFolder(input.folder ?? []),
      createdAt: toIsoDate(input.created),
    },
  };
}
