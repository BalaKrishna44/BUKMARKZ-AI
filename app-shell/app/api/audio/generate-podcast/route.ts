import { after } from 'next/server';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { admin, json, requireUser } from '@/lib/server';
import { processNextEpisode } from '@/lib/podcast/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 300;               // after() work runs inside this budget; the cron route drains anything left

const DAILY_LIMIT = Number(process.env.PODCAST_EPISODES_PER_DAY ?? 5);
const Body = z.object({
  itemIds: z.array(z.string().uuid()).min(1).max(10),
  style: z.enum(['conversation', 'briefing']).default('conversation'),
  targetMinutes: z.number().int().min(2).max(25).default(8),
  voiceA: z.string().regex(/^[A-Za-z0-9_-]{2,40}$/).optional(),
  voiceB: z.string().regex(/^[A-Za-z0-9_-]{2,40}$/).optional(),
});

export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: 'bad_request', detail: p.error.flatten() }, 400);
  const b = p.data;
  const ids = [...new Set(b.itemIds)];

  // Cost guard: TTS + LLM calls cost money per episode.
  const since = new Date(Date.now() - 864e5).toISOString();
  const { count } = await admin.from('podcast_episodes').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', since);
  if ((count ?? 0) >= DAILY_LIMIT) return json({ error: 'daily_limit', limit: DAILY_LIMIT }, 429);

  // Every id must belong to the caller and have something to read.
  const { data: items } = await admin.from('oneclist_items').select('id,title,content_text,summary,note').eq('user_id', user.id).in('id', ids);
  if (!items || items.length !== ids.length) return json({ error: 'items_not_found' }, 404);
  const unreadable = items.filter((i) => [i.content_text, i.summary, i.note].filter(Boolean).join(' ').trim().length < 80);
  if (unreadable.length) return json({ error: 'no_text', items: unreadable.map((i) => ({ id: i.id, title: i.title })) }, 422);

  let { data: feed } = await admin.from('podcast_feeds').select('token').eq('user_id', user.id).maybeSingle();
  if (!feed) {
    const ins = await admin.from('podcast_feeds').insert({ user_id: user.id, token: randomBytes(32).toString('base64url') }).select('token').single();
    feed = ins.data ?? (await admin.from('podcast_feeds').select('token').eq('user_id', user.id).single()).data;   // lost a race => read the winner's token
  }

  const { data: ep, error } = await admin.from('podcast_episodes').insert({
    user_id: user.id, source_item_ids: ids, style: b.style, target_minutes: b.targetMinutes, voice_a: b.voiceA ?? null, voice_b: b.voiceB ?? null,
    title: items.length === 1 ? items[0].title : `Briefing: ${items.length} items`,
  }).select('id').single();
  if (error || !ep) return json({ error: 'db_error' }, 500);

  after(async () => { await processNextEpisode(); });          // start now; keeps running after the response is sent

  return json({
    episodeId: ep.id, status: 'queued',
    feedUrl: `${process.env.APP_URL}/api/podcast/${feed!.token}/feed.xml`,
  }, 202);
}

export async function GET(req: Request) {                      // poll status
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const { data } = await admin.from('podcast_episodes').select('id,title,status,duration_sec,audio_bytes,error,created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(30);
  return json({ episodes: data ?? [] });
}
