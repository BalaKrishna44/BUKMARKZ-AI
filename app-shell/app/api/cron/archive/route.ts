import { admin, isCron, json } from '@/lib/server';
import { MAX_ATTEMPTS, runQueue, supabaseDeps } from '@/lib/archive/archiver';
import { STALE_CLAIM_MS } from '@/lib/archive/pure';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Every few minutes: pick up pending items, retry failures (capped), and rescue claims stuck in 'processing'. */
export async function GET(req: Request) {
  if (!isCron(req)) return json({ error: 'unauthorized' }, 401);
  const stale = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const { data, error } = await admin.from('oneclist_items').select('id,user_id')
    .or(`archive_status.eq.pending,and(archive_status.eq.failed,archive_attempts.lt.${MAX_ATTEMPTS}),and(archive_status.eq.processing,archive_claimed_at.lt.${stale})`)
    .order('archive_claimed_at', { ascending: true, nullsFirst: true }).limit(8);
  if (error) return json({ error: 'db_error' }, 500);
  return json(await runQueue(data ?? [], supabaseDeps(admin)));
}
