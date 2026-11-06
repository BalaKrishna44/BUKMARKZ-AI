import { z } from 'zod';
import { admin, json, requireUser } from '@/lib/server';
import { normalizeLanguage } from '@/lib/snippets/extract';
import { NO_STORE, writeAllowed } from '@/lib/snippets/http';

export const runtime = 'nodejs';
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const Patch = z.object({ title: z.string().trim().min(1).max(120).optional(), note: z.string().trim().max(1000).nullable().optional(), language: z.string().trim().max(30).optional() }).strict();

/** PATCH { title?, note?, language? }: metadata only. The code itself is immutable (edit = delete + save again). */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!writeAllowed(req)) return json({ error: 'forbidden' }, 403, NO_STORE);
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401, NO_STORE);
  const { id } = await ctx.params;
  if (!ID.test(id)) return json({ error: 'bad_request' }, 400, NO_STORE);
  const p = Patch.safeParse(await req.json().catch(() => null));
  if (!p.success || Object.keys(p.data).length === 0) return json({ error: 'invalid' }, 400, NO_STORE);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (p.data.title !== undefined) patch.title = p.data.title;
  if (p.data.note !== undefined) patch.note = p.data.note || null;
  if (p.data.language !== undefined) {
    const l = normalizeLanguage(p.data.language);
    if (!l) return json({ error: 'invalid_language' }, 400, NO_STORE);
    patch.language = l;
  }
  const { data, error } = await admin.from('code_snippets').update(patch).eq('id', id).eq('user_id', user.id).select('id,title,language,note').maybeSingle();
  if (error) return json({ error: 'server_error' }, 500, NO_STORE);
  return data ? json({ snippet: data }, 200, NO_STORE) : json({ error: 'not_found' }, 404, NO_STORE);
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!writeAllowed(req)) return json({ error: 'forbidden' }, 403, NO_STORE);
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401, NO_STORE);
  const { id } = await ctx.params;
  if (!ID.test(id)) return json({ error: 'bad_request' }, 400, NO_STORE);
  const { data, error } = await admin.from('code_snippets').delete().eq('id', id).eq('user_id', user.id).select('id');
  if (error) return json({ error: 'server_error' }, 500, NO_STORE);
  return data?.length ? json({ deleted: true }, 200, NO_STORE) : json({ error: 'not_found' }, 404, NO_STORE);
}
