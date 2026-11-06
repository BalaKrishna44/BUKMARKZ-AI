import { z } from 'zod';
import { admin, json, requireUser } from '@/lib/server';
import { checkUrl } from '@/lib/url';
import { extractFromHtml } from '@/lib/snippets/extract';
import { NO_STORE, writeAllowed } from '@/lib/snippets/http';

export const runtime = 'nodejs';
export const maxDuration = 20;
const Body = z.object({ url: z.string().trim().min(8).max(2048) }).strict();
const HOURLY = 30;

/**
 * POST { url } -> { url, title, candidates:[{id, title, language, code, lines, secret}] }
 * Fetches the page SSRF-safely and returns code blocks for the user to pick from. NOTHING is saved here.
 * Candidates flagged `secret` are shown but cannot be saved (POST /api/snippets refuses them again).
 */
export async function POST(req: Request) {
  if (!writeAllowed(req)) return json({ error: 'forbidden' }, 403, NO_STORE);
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401, NO_STORE);
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return json({ error: 'invalid' }, 400, NO_STORE);
  const c = checkUrl(b.data.url);
  if (!c.ok) return json({ error: 'invalid_url', message: 'Only plain http(s) addresses can be read.' }, 400, NO_STORE);

  // An outbound fetch on the user's behalf is the expensive/abusable part: cap it per user per hour.
  const { data: allowed, error: rlErr } = await admin.rpc('rate_hit', { p_user: user.id, p_key: 'snippet_extract', p_limit: HOURLY, p_window_s: 3600 });
  if (rlErr) return json({ error: 'server_error' }, 500, NO_STORE);
  if (allowed === false) return json({ error: 'rate_limited', message: `Up to ${HOURLY} page reads per hour. Try again later.` }, 429, { ...NO_STORE, 'retry-after': '600' });

  let html: string;
  try {
    const { safeFetch } = await import('@/lib/ssrf');                 // lazily: pulls in undici
    const r = await safeFetch(c.url, { maxBytes: 2_500_000, timeoutMs: 8_000, headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'BukmarkzBot/1.0 (+https://bukmarkz.com)' } });
    const type = (r.headers.get('content-type') ?? '').toLowerCase();
    if (r.status < 200 || r.status >= 300) return json({ error: 'fetch_failed', message: `The page answered ${r.status}.` }, 422, NO_STORE);
    if (!/^(text\/html|application\/xhtml\+xml)/.test(type)) return json({ error: 'not_html', message: 'That address is not a web page.' }, 422, NO_STORE);
    html = new TextDecoder('utf-8', { fatal: false }).decode(r.body);
  } catch {
    return json({ error: 'fetch_failed', message: 'Could not read that page (it may be private, slow or blocked).' }, 422, NO_STORE);
  }
  const { pageTitle, blocks } = extractFromHtml(html);
  return json({ url: c.url, title: pageTitle, candidates: blocks.map((x, id) => ({ id, ...x })) }, 200, NO_STORE);
}
