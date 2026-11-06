import { admin, json, requireUser } from '@/lib/server';
import { checkUrl } from '@/lib/url';
import { toApa, toBibtex, toCsl, toMarkdownNotes, type CiteEntry, type QuoteRow } from '@/lib/cite/format';
import { NO_STORE } from '@/lib/cite/http';

export const runtime = 'nodejs';
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FORMATS = {
  bibtex: { type: 'application/x-bibtex', ext: 'bib' }, apa: { type: 'text/plain', ext: 'txt' },
  csl: { type: 'application/json', ext: 'json' }, md: { type: 'text/markdown', ext: 'md' },
} as const;

/**
 * GET /api/cite/export?format=bibtex|apa|csl|md & (ids=a,b,c | url=<page> | all=1) & download=1
 * One bibliography entry per page, however many passages were highlighted on it. `md` instead lists every quote with its deep link.
 */
export async function GET(req: Request) {
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401, NO_STORE);
  const u = new URL(req.url);
  const format = u.searchParams.get('format') ?? 'bibtex';
  if (!(format in FORMATS)) return json({ error: 'bad_format', allowed: Object.keys(FORMATS) }, 400, NO_STORE);
  const f = FORMATS[format as keyof typeof FORMATS];

  let q = admin.from('highlights').select('id,source_url,url_key,source_title,quote,prefix,suffix,note,created_at').eq('user_id', user.id).order('created_at', { ascending: true }).order('id', { ascending: true }).limit(5000);
  const ids = (u.searchParams.get('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length) {
    if (ids.length > 200 || !ids.every((i) => ID.test(i))) return json({ error: 'bad_request', message: 'ids must be up to 200 highlight ids.' }, 400, NO_STORE);
    q = q.in('id', ids);
  } else if (u.searchParams.get('url')) {
    const c = checkUrl(u.searchParams.get('url')); if (!c.ok) return json({ error: 'bad_request' }, 400, NO_STORE);
    q = q.eq('url_key', c.key);
  } else if (u.searchParams.get('all') !== '1') {
    return json({ error: 'bad_request', message: 'Pass ids, url or all=1.' }, 400, NO_STORE);
  }
  const { data: rows, error } = await q;
  if (error) return json({ error: 'server_error' }, 500, NO_STORE);
  if (!rows?.length) return json({ error: 'nothing_to_export' }, 404, NO_STORE);

  const keys = [...new Set(rows.map((r) => r.url_key as string))];
  const metaRes = await admin.from('citation_meta').select('url_key,title,authors,published,container,publisher,doi').eq('user_id', user.id).in('url_key', keys);
  if (metaRes.error) return json({ error: 'server_error' }, 500, NO_STORE);
  const metaBy = new Map((metaRes.data ?? []).map((m) => [m.url_key as string, m]));
  const accessed = new Date().toISOString().slice(0, 10);

  const groups = keys.map((k) => {
    const mine = rows.filter((r) => r.url_key === k);
    const m = metaBy.get(k);
    const entry: CiteEntry = { url: mine[0].source_url, title: m?.title ?? mine[0].source_title ?? null, authors: m?.authors ?? [], published: m?.published ?? null, container: m?.container ?? null, publisher: m?.publisher ?? null, doi: m?.doi ?? null, accessed };
    return { entry, quotes: mine.map((r): QuoteRow => ({ quote: r.quote, note: r.note, prefix: r.prefix, suffix: r.suffix, source_url: r.source_url })) };
  });
  const entries = groups.map((g) => g.entry);
  const body = format === 'bibtex' ? toBibtex(entries) : format === 'apa' ? toApa(entries) : format === 'csl' ? toCsl(entries) : toMarkdownNotes(groups);

  const headers: Record<string, string> = { ...NO_STORE, 'content-type': `${f.type}; charset=utf-8`, 'x-content-type-options': 'nosniff' };
  if (u.searchParams.get('download') === '1') headers['content-disposition'] = `attachment; filename="bukmarkz-${format === 'md' ? 'notes' : 'bibliography'}.${f.ext}"`;
  return new Response(body, { status: 200, headers });
}
