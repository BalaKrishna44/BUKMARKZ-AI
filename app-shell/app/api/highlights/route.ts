import { z } from 'zod';
import { admin, json, requireUser } from '@/lib/server';
import { checkUrl } from '@/lib/url';
import { buildFragmentUrl } from '@/lib/cite/fragment';
import { normalizeMeta, MAX_LD_CHARS } from '@/lib/cite/meta';
import { NO_STORE, writeAllowed } from '@/lib/cite/http';

export const runtime = 'nodejs';
const COLS = 'id,source_url,url_key,source_title,quote,prefix,suffix,note,item_id,created_at';

/** GET /api/highlights?q=&url=&limit=20&before=<ISO created_at> -> { highlights:[{..., fragmentUrl}], meta:{[url_key]: details}, next } */
export async function GET(req: Request) {
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401, NO_STORE);
  const u = new URL(req.url);
  const q = (u.searchParams.get('q') ?? '').trim().slice(0, 200);
  const limit = Math.min(Math.max(parseInt(u.searchParams.get('limit') ?? '20', 10) || 20, 1), 50);
  const before = u.searchParams.get('before');
  if (before && Number.isNaN(Date.parse(before))) return json({ error: 'bad_request' }, 400, NO_STORE);
  const pageUrl = u.searchParams.get('url');
  let key: string | null = null;
  if (pageUrl) { const c = checkUrl(pageUrl); if (!c.ok) return json({ error: 'bad_request' }, 400, NO_STORE); key = c.key; }

  let query = admin.from('highlights').select(COLS).eq('user_id', user.id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
  if (key) query = query.eq('url_key', key);
  if (before) query = query.lt('created_at', before);
  if (q) query = query.textSearch('fts', q, { type: 'websearch', config: 'english' });
  const { data, error } = await query;
  if (error) return json({ error: 'server_error' }, 500, NO_STORE);
  const rows = data ?? [];
  const page = rows.slice(0, limit);
  const keys = [...new Set(page.map((h) => h.url_key as string))];
  const metaRes = keys.length ? await admin.from('citation_meta').select('url_key,title,authors,published,container,publisher,doi,edited').eq('user_id', user.id).in('url_key', keys) : { data: [], error: null };
  if (metaRes.error) return json({ error: 'server_error' }, 500, NO_STORE);
  return json({
    highlights: page.map((h) => ({ ...h, fragmentUrl: buildFragmentUrl(h.source_url, h.quote, h) ?? h.source_url })),
    meta: Object.fromEntries((metaRes.data ?? []).map((m) => [m.url_key, m])),
    next: rows.length > limit ? page[page.length - 1].created_at : null,
  }, 200, NO_STORE);
}

const Body = z.object({
  url: z.string().trim().max(2048),
  title: z.string().max(500).optional(),
  quote: z.string().max(6000),                                              // trimmed to 2000 after whitespace is collapsed
  prefix: z.string().max(400).optional(), suffix: z.string().max(400).optional(),
  note: z.string().trim().max(1000).optional(),
  page: z.object({                                                          // raw tags read by the extension; normalised below
    title: z.string().max(1000).optional(),
    metas: z.array(z.tuple([z.string().max(100), z.string().max(2000)])).max(200),
    ld: z.array(z.string().max(MAX_LD_CHARS)).max(5),
  }).strict().optional(),
}).strict();

const ERR: Record<string, [number, string]> = {
  daily_limit: [429, 'Daily highlight limit reached (300). Try again tomorrow.'],
  vault_full: [403, 'Your highlight vault is full (5,000). Delete some to save more.'],
  page_limit: [403, 'This page already has 200 highlights.'],
  invalid: [400, 'Select between 3 and 2,000 characters of text.'],
};

/** POST /api/highlights { url, quote, title?, prefix?, suffix?, note?, page? } -> 201 { id, duplicate, fragmentUrl } */
export async function POST(req: Request) {
  if (!writeAllowed(req)) return json({ error: 'forbidden' }, 403, NO_STORE);
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401, NO_STORE);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'invalid', issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }, 400, NO_STORE);
  const b = parsed.data;
  const c = checkUrl(b.url);
  if (!c.ok) return json({ error: 'invalid_source_url', message: 'Highlights can only be saved from regular web pages.' }, 400, NO_STORE);
  const quote = b.quote.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (quote.replace(/\s+/g, ' ').length < 3) return json({ error: 'invalid', message: ERR.invalid[1] }, 400, NO_STORE);
  if (quote.replace(/\s+/g, ' ').length > 2000) return json({ error: 'too_long', message: 'That selection is longer than 2,000 characters. Select a shorter passage.' }, 413, NO_STORE);

  const { data: allowed } = await admin.rpc('rate_hit', { p_user: user.id, p_key: 'highlight', p_limit: 60, p_window_s: 60 });
  if (allowed === false) return json({ error: 'rate_limited', message: 'Slow down a little.' }, 429, { ...NO_STORE, 'retry-after': '30' });

  const meta = b.page ? normalizeMeta({ url: c.url, title: b.page.title ?? b.title ?? '', metas: b.page.metas, ld: b.page.ld }) : null;
  const { data, error } = await admin.rpc('save_highlight', { p_user: user.id, p_url: c.url, p_url_key: c.key, p_title: b.title ?? meta?.title ?? null, p_quote: quote, p_prefix: b.prefix ?? null, p_suffix: b.suffix ?? null, p_note: b.note ?? null, p_meta: meta });
  if (error) {
    const known = ERR[(error.message ?? '').trim()];
    if (known) return json({ error: (error.message ?? '').trim(), message: known[1] }, known[0], NO_STORE);
    console.error('save_highlight failed', error.code);                      // never log quotes or URLs
    return json({ error: 'server_error' }, 500, NO_STORE);
  }
  return json({ id: data.id, duplicate: data.duplicate, fragmentUrl: buildFragmentUrl(c.url, quote, { prefix: b.prefix, suffix: b.suffix }) ?? c.url }, data.duplicate ? 200 : 201, NO_STORE);
}
