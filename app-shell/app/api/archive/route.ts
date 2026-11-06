import { after } from 'next/server';
import { admin, json, requireUser } from '@/lib/server';
import { archiveItem, supabaseDeps } from '@/lib/archive/archiver';

export const runtime = 'nodejs';        // JSDOM needs Node APIs
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST { itemId } -> 202 and archive in the background. The webhook/extension calls this right after a save. */
export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const body = await req.json().catch(() => null);
  const itemId = typeof body?.itemId === 'string' ? body.itemId : '';
  if (!UUID.test(itemId)) return json({ error: 'bad_item_id' }, 400);

  const { data } = await admin.from('oneclist_items').select('id,archive_status').eq('id', itemId).eq('user_id', user.id).maybeSingle();
  if (!data) return json({ error: 'not_found' }, 404);
  if (data.archive_status === 'processing') return json({ status: 'processing' }, 202);

  after(async () => { try { await archiveItem(itemId, user.id, supabaseDeps(admin)); } catch { /* failure code is already stored on the row */ } });
  return json({ status: 'queued' }, 202);
}
