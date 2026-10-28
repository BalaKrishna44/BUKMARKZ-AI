import { FEED_LIMIT, SUPABASE_ANON_KEY, SUPABASE_URL } from '../shared/config';
import { parseFeedRows, type FeedItem } from './feed';

export const FEED_SELECT = 'id,title,url,favicon_url,ai_category,summary_tldr,created_at';

export class FeedError extends Error {
  constructor(public code: 'unauthorized' | 'network' | 'server', message: string) { super(message); }
}

export const feedUrl = (limit = FEED_LIMIT) =>
  `${SUPABASE_URL}/rest/v1/extension_feed?select=${FEED_SELECT}&order=created_at.desc&limit=${limit}`;

/**
 * Newest first. Uses PostgREST directly (the same call supabase-js makes) so the popup does not bundle the SDK:
 *   supabase.from('extension_feed').select(FEED_SELECT).order('created_at', { ascending: false }).limit(500)
 * The user's access token goes in Authorization, so row-level security returns only their rows.
 */
export async function fetchFeed(accessToken: string, signal?: AbortSignal): Promise<FeedItem[]> {
  let res: Response;
  try {
    res = await fetch(feedUrl(), { signal, credentials: 'omit', headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new FeedError('network', 'Could not reach Bukmarkz.');
  }
  if (res.status === 401 || res.status === 403) throw new FeedError('unauthorized', 'Your session expired.');
  if (!res.ok) throw new FeedError('server', `Bukmarkz answered ${res.status}.`);
  return parseFeedRows(await res.json());
}

/* Cache: lets the popup paint instantly, then refresh. One entry per user so accounts never mix. */
const CACHE_KEY = 'bukmarkz.feed';
interface Cache { userId: string; at: number; items: FeedItem[] }
export async function readFeedCache(userId: string): Promise<FeedItem[] | null> {
  const c = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY] as Cache | undefined;
  return c && c.userId === userId && Array.isArray(c.items) ? parseFeedRows(c.items) : null;
}
export const writeFeedCache = (userId: string, items: FeedItem[]) => chrome.storage.local.set({ [CACHE_KEY]: { userId, at: Date.now(), items } satisfies Cache });
export const clearFeedCache = () => chrome.storage.local.remove(CACHE_KEY);
