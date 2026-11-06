import { z } from 'zod';
import { admin, json, requireUser } from '@/lib/server';
import { NO_STORE, writeAllowed } from '@/lib/cite/http';

export const runtime = 'nodejs';
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const Patch = z.object({ note: z.string().trim().max(1000).nullable() }).strict();

/** PATCH { note } -> the quote is immutable (a different passage is a different highlight). */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!writeAllowed(req)) return json({ error: 'forbidden' }, 403, NO_STORE);
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401, NO_STORE);
  const { id } = await ctx.params;
  if (!ID.test(id)) return json({ error: 'bad_request' }, 400, NO_STORE);
  const p = Patch.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: 'invalid' }, 400, NO_STORE);
  const { data, error } = await admin.from('highlights').update({ note: p.data.note || null }).eq('id', id).eq('user_id', user.id).select('id,note').maybeSingle();
  if (error) return json({ error: 'server_error' }, 500, NO_STORE);
  return data ? json({ highlight: data }, 200, NO_STORE) : json({ error: 'not_found' }, 404, NO_STORE);
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!writeAllowed(req)) return json({ error: 'forbidden' }, 403, NO_STORE);
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401, NO_STORE);
  const { id } = await ctx.params;
  if (!ID.test(id)) return json({ error: 'bad_request' }, 400, NO_STORE);
  const { data, error } = await admin.from('highlights').delete().eq('id', id).eq('user_id', user.id).select('id');
  if (error) return json({ error: 'server_error' }, 500, NO_STORE);
  return data?.length ? json({ deleted: true }, 200, NO_STORE) : json({ error: 'not_found' }, 404, NO_STORE);
}
