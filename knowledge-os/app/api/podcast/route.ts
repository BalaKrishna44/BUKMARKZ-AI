import { after } from 'next/server';
import { admin, json, requireUser } from '@/lib/server';
import { enqueueDailyBriefing } from '@/lib/podcast/digest';
import { processNextEpisode } from '@/lib/podcast/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 300;       // after() keeps working inside this budget; /api/cron/podcast drains anything left

const feedUrl = (token: string) => `${process.env.APP_URL}/api/podcast/${token}/feed.xml`;

/** POST /api/podcast  ->  "make my Daily Knowledge Briefing now" (everything saved in the last 24 hours, about 2 minutes of audio). */
export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  try {
    const r = await enqueueDailyBriefing(user.id, { manual: true });
    switch (r.status) {
      case 'nothing_new': return json({ status: 'nothing_new', message: 'You have not saved anything readable in the last 24 hours.' }, 200);
      case 'limit': return json({ error: 'daily_limit', detail: r.detail }, 429);
      case 'error': return json({ error: 'server_error', detail: r.detail }, 500);
      case 'exists': return json({ status: 'exists', episodeId: r.episodeId, items: r.items, feedUrl: feedUrl(r.feedToken) }, 200);
      case 'queued':
        after(async () => { try { await processNextEpisode(); } catch (e) { console.error('podcast after()', e); } });   // start now, even after the response is sent
        return json({ status: 'queued', episodeId: r.episodeId, items: r.items, feedUrl: feedUrl(r.feedToken) }, 202);
    }
  } catch (e) {
    console.error('POST /api/podcast', e);
    return json({ error: 'server_error' }, 500);
  }
}

/** GET /api/podcast  ->  recent episodes and their status, for polling. */
export async function GET(req: Request) {
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const { data, error } = await admin.from('podcast_episodes').select('id,title,status,duration_sec,audio_bytes,error,created_at,published_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(30);
  if (error) return json({ error: 'db_error' }, 500);
  return json({ episodes: data ?? [] });
}
