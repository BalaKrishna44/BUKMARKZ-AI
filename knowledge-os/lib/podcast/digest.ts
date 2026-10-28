import { randomBytes } from 'node:crypto';
import { admin } from '../server';
import { DIGEST_HOURS, pickDigestItems, sinceIso, sortedIds, type DigestRow } from './digestPick';

const DAILY_LIMIT = Number(process.env.PODCAST_EPISODES_PER_DAY ?? 5);
const COLS = 'id,title,url,summary,note,content_text,created_at,ai_status';

export type EnqueueResult =
  | { status: 'queued' | 'exists'; episodeId: string; items: number; feedToken: string }
  | { status: 'nothing_new' | 'limit' | 'error'; detail?: string };

/** One private feed per user. Creating it twice at the same moment is safe: the loser reads the winner's token. */
export async function ensureFeedToken(userId: string): Promise<string> {
  const got = await admin.from('podcast_feeds').select('token').eq('user_id', userId).maybeSingle();
  if (got.data?.token) return got.data.token;
  const ins = await admin.from('podcast_feeds').insert({ user_id: userId, token: randomBytes(32).toString('base64url') }).select('token').maybeSingle();
  if (ins.data?.token) return ins.data.token;
  const again = await admin.from('podcast_feeds').select('token').eq('user_id', userId).single();
  if (again.error || !again.data) throw new Error('could not create podcast feed');
  return again.data.token;
}

/**
 * Turn everything the user saved in the last 24 hours into ONE 2-minute, two-host episode (queued; the worker does the rest).
 * Idempotent: the same set of items never produces a second episode within 24 hours.
 */
export async function enqueueDailyBriefing(userId: string, opts: { now?: Date; maxItems?: number; targetMinutes?: number; manual?: boolean } = {}): Promise<EnqueueResult> {
  const now = opts.now ?? new Date();
  const since = sinceIso(now, DIGEST_HOURS);

  const { data: rows, error } = await admin.from('oneclist_items').select(COLS).eq('user_id', userId).gte('created_at', since).order('created_at', { ascending: false }).limit(60);
  if (error) return { status: 'error', detail: 'items query failed' };
  const picked = pickDigestItems((rows ?? []) as DigestRow[], opts.maxItems);
  if (!picked.length) return { status: 'nothing_new' };
  const ids = sortedIds(picked);
  const feedToken = await ensureFeedToken(userId);

  // Same items already turned into an episode today (queued, in progress or ready)? Hand that one back.
  const { data: dup } = await admin.from('podcast_episodes').select('id,status').eq('user_id', userId).gte('created_at', since)
    .eq('source_item_ids', `{${ids.join(',')}}`).neq('status', 'failed').limit(1).maybeSingle();
  if (dup) return { status: 'exists', episodeId: dup.id, items: ids.length, feedToken };

  // Cost guard (LLM + text-to-speech cost money per episode). Counts every episode in the last 24 hours.
  const { count } = await admin.from('podcast_episodes').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', since);
  if ((count ?? 0) >= DAILY_LIMIT) return { status: 'limit', detail: `max ${DAILY_LIMIT} episodes per 24 hours` };

  const day = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  const { data: ep, error: insErr } = await admin.from('podcast_episodes').insert({
    user_id: userId, source_item_ids: ids, style: 'conversation', target_minutes: opts.targetMinutes ?? 2,
    title: `Daily Knowledge Briefing, ${day}`, description: `${ids.length} item${ids.length === 1 ? '' : 's'} you saved in the last 24 hours.`,
  }).select('id').single();
  if (insErr || !ep) return { status: 'error', detail: 'could not create episode' };
  return { status: 'queued', episodeId: ep.id, items: ids.length, feedToken };
}
