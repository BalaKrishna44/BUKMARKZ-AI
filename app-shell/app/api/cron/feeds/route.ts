import { isCron, json } from '@/lib/server';
import { runOnce } from '@/worker/feedWorker';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isCron(req)) return json({ error: 'unauthorized' }, 401);
  const results = await runOnce(20);
  return json({ processed: results.length, failed: results.filter((r) => !r.ok).length });
}
