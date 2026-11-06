import { z } from 'zod';
import { admin, json, requireUser } from '@/lib/server';
import { checkUrl } from '@/lib/url';
import { normalizeLanguage, prepareForSave } from '@/lib/snippets/extract';
import { NO_STORE, writeAllowed } from '@/lib/snippets/http';

export const runtime = 'nodejs';
const COLS = 'id,title,language,code,source_url,source_title,note,item_id,created_at';

/** GET /api/snippets?q=&lang=&limit=20&before=<ISO created_at> -> { snippets, languages?, next } */
export async function GET(req: Request) {
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401, NO_STORE);
  const u = new URL(req.url);
  const q = (u.searchParams.get('q') ?? '').trim().slice(0, 200);
  const langRaw = u.searchParams.get('lang');
  const lang = langRaw ? normalizeLanguage(langRaw) : null;
  if (langRaw && !lang) return json({ snippets: [], next: null, languages: [] }, 200, NO_STORE);
  const limit = Math.min(Math.max(parseInt(u.searchParams.get('limit') ?? '20', 10) || 20, 1), 30);
  const before = u.searchParams.get('before');
  if (before && Number.isNaN(Date.parse(before))) return json({ error: 'bad_request' }, 400, NO_STORE);

  let query = admin.from('code_snippets').select(COLS).eq('user_id', user.id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
  if (lang) query = query.eq('language', lang);
  if (before) query = query.lt('created_at', before);
  if (q) query = query.textSearch('fts', q, { type: 'websearch', config: 'simple' });          // websearch syntax never throws on odd input
  const [rows, langs] = await Promise.all([query, before ? Promise.resolve(null) : admin.rpc('snippet_languages', { p_user: user.id })]);
  if (rows.error) return json({ error: 'server_error' }, 500, NO_STORE);
  const data = rows.data ?? [];
  const page = data.slice(0, limit);
  return json({
    snippets: page,
    next: data.length > limit ? page[page.length - 1].created_at : null,
    ...(langs ? { languages: ((langs.data ?? []) as { language: string; n: number }[]).map((l) => ({ language: l.language, count: Number(l.n) })) } : {}),
  }, 200, NO_STORE);
}

const Body = z.object({
  sourceUrl: z.string().trim().max(2048).optional(),
  sourceTitle: z.string().trim().max(200).optional(),
  itemId: z.string().uuid().optional(),
  snippets: z.array(z.object({
    code: z.string().max(60_000), language: z.string().trim().max(30).optional(),
    title: z.string().max(300).optional(), note: z.string().trim().max(1000).optional(),
  }).strict()).min(1).max(20),
}).strict();

const ERR: Record<string, [number, string]> = {
  daily_limit: [429, 'Daily snippet limit reached (300). Try again tomorrow.'],
  vault_full: [403, 'Your snippet vault is full (5,000). Delete some to save more.'],
};

/** POST /api/snippets { sourceUrl?, sourceTitle?, itemId?, snippets:[{code, language?, title?, note?}] } -> 201 { saved, skipped, rejected:[{index, reason}] } */
export async function POST(req: Request) {
  if (!writeAllowed(req)) return json({ error: 'forbidden' }, 403, NO_STORE);
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401, NO_STORE);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'invalid', issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }, 400, NO_STORE);
  const b = parsed.data;

  let url: string | null = null, key: string | null = null;
  if (b.sourceUrl) {
    const c = checkUrl(b.sourceUrl);
    if (!c.ok) return json({ error: 'invalid_source_url', message: 'sourceUrl must be a plain http(s) address.' }, 400, NO_STORE);
    url = c.url; key = c.key;
  }

  // The client's cleaning and its secret check are courtesy only: everything is redone here.
  const accepted: { title: string; language: string; code: string; note: string | null }[] = [];
  const rejected: { index: number; reason: string }[] = [];
  b.snippets.forEach((s, index) => {
    const p = prepareForSave(s);
    if ('error' in p) rejected.push({ index, reason: p.error === 'secret' ? `looks_like_secret:${p.secret}` : p.error });
    else accepted.push({ title: p.title, language: p.language, code: p.code, note: s.note || null });
  });
  if (!accepted.length) return json({ error: 'nothing_to_save', rejected }, 422, NO_STORE);

  const { data, error } = await admin.rpc('save_snippets', { p_user: user.id, p_source_url: url, p_source_title: b.sourceTitle ?? null, p_url_key: key, p_item_id: b.itemId ?? null, p_items: accepted });
  if (error) {
    const known = ERR[(error.message ?? '').trim()];
    if (known) return json({ error: (error.message ?? '').trim(), message: known[1] }, known[0], NO_STORE);
    console.error('save_snippets failed', error.code);                              // never log code or URLs
    return json({ error: 'server_error' }, 500, NO_STORE);
  }
  return json({ saved: data.saved, skipped: data.skipped, ids: data.ids, linkedItemId: data.item_id, rejected }, 201, NO_STORE);
}
