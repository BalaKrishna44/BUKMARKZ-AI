import { admin, isCron, json } from '@/lib/server';
import { enqueueDailyBriefing } from '@/lib/podcast/digest';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Once a day: queue a briefing for every user who has a private feed (opting in = creating the feed) and saved something in the last 24 hours.
 * It only QUEUES. /api/cron/podcast (every 5 minutes) does the writing and speaking, so this stays fast.
 */
export async function GET(req: Request) {
  if (!isCron(req)) return json({ error: 'unauthorized' }, 401);
  const end = Date.now() + 50_000;
  const tally: Record<string, number> = { queued: 0, exists: 0, nothing_new: 0, limit: 0, error: 0 };
  for (let from = 0; Date.now() < end; from += 200) {
    const { data: feeds, error } = await admin.from('podcast_feeds').select('user_id').order('user_id').range(from, from + 199);
    if (error) return json({ error: 'db_error', tally }, 500);
    if (!feeds?.length) break;
    for (const f of feeds) {
      if (Date.now() >= end) break;
      try { tally[(await enqueueDailyBriefing(f.user_id)).status]++; } catch { tally.error++; }
    }
    if (feeds.length < 200) break;
  }
  return json(tally);
}
