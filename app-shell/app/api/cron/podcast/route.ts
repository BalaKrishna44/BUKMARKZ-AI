import { isCron, json } from '@/lib/server';
import { processNextEpisode } from '@/lib/podcast/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** Drains queued / stuck episodes. Schedule every 5 minutes. */
export async function GET(req: Request) {
  if (!isCron(req)) return json({ error: 'unauthorized' }, 401);
  const end = Date.now() + 240_000; let n = 0;
  while (Date.now() < end && (await processNextEpisode())) n++;
  return json({ processed: n });
}
