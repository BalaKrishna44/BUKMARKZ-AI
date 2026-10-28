import { z } from 'zod';
import { admin, json, requireUser } from '@/lib/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

const Body = z.object({
  threshold: z.number().min(0.5).max(0.99).default(0.8),
  k: z.number().int().min(1).max(30).default(8),
  itemIds: z.array(z.string().uuid()).max(500).optional(),     // omit => full rebuild
});

export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const p = Body.safeParse(await req.json().catch(() => ({})));
  if (!p.success) return json({ error: 'bad_request' }, 400);

  // Full rebuilds are O(items * log items); allow one per 5 minutes per user.
  if (!p.data.itemIds) {
    const { data: last } = await admin.from('item_edges').select('updated_at').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (last && Date.now() - +new Date(last.updated_at) < 300_000) return json({ error: 'too_soon' }, 429);
  }
  const { data, error } = await admin.rpc('rebuild_item_edges', { p_user: user.id, p_threshold: p.data.threshold, p_k: p.data.k, p_item_ids: p.data.itemIds ?? null });
  if (error) return json({ error: 'db_error', detail: error.message }, 500);
  return json({ edges: data });
}
