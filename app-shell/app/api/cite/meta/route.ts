import { z } from 'zod';
import { admin, json, requireUser } from '@/lib/server';
import { checkUrl } from '@/lib/url';
import { NO_STORE, writeAllowed } from '@/lib/cite/http';

export const runtime = 'nodejs';
const Body = z.object({
  url: z.string().trim().max(2048),
  title: z.string().trim().max(300).optional(), authors: z.array(z.string().trim().max(120)).max(30).optional(),
  published: z.string().trim().max(10).optional(), container: z.string().trim().max(200).optional(), publisher: z.string().trim().max(200).optional(), doi: z.string().trim().max(250).optional(),
}).strict();
const ERR: Record<string, [number, string]> = {
  invalid_date: [400, 'Use YYYY, YYYY-MM or YYYY-MM-DD.'], invalid_doi: [400, 'Enter a bare DOI such as 10.1234/abc (no https://doi.org/).'], not_found: [404, 'Save a highlight from this page first.'],
};

/** PUT { url, title?, authors?, published?, container?, publisher?, doi? }: the user's own correction. Omitted fields are cleared. */
export async function PUT(req: Request) {
  if (!writeAllowed(req)) return json({ error: 'forbidden' }, 403, NO_STORE);
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401, NO_STORE);
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: 'invalid' }, 400, NO_STORE);
  const c = checkUrl(p.data.url);
  if (!c.ok) return json({ error: 'invalid_source_url' }, 400, NO_STORE);
  const { url: _u, ...meta } = p.data;
  const { error } = await admin.rpc('set_cite_meta', { p_user: user.id, p_url_key: c.key, p_meta: meta });
  if (error) {
    const known = ERR[(error.message ?? '').trim()];
    if (known) return json({ error: (error.message ?? '').trim(), message: known[1] }, known[0], NO_STORE);
    return json({ error: 'server_error' }, 500, NO_STORE);
  }
  return json({ ok: true }, 200, NO_STORE);
}
