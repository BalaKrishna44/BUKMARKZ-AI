import { z } from 'zod';
import { admin, json, requireUser } from '@/lib/server';
import { discoverFeedUrl, fetchFeed } from '@/lib/feeds/fetchFeed';
import { parsePublicUrl, safeFetch } from '@/lib/ssrf';

export const runtime = 'nodejs';
const MAX_FEEDS = 200;

export async function GET(req: Request) {
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const { data } = await admin.from('feeds').select('id,url,title,site_url,status,last_fetched_at,last_error,fetch_interval_min').eq('user_id', user.id).order('created_at');
  return json({ feeds: data ?? [] });
}

const Body = z.object({ url: z.string().url().max(2000), intervalMin: z.number().int().min(15).max(1440).optional() });

/** Add a feed. Accepts a feed URL or a normal site URL (feed is auto-discovered). Validates before storing. */
export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: 'bad_request' }, 400);

  const { count } = await admin.from('feeds').select('id', { count: 'exact', head: true }).eq('user_id', user.id);
  if ((count ?? 0) >= MAX_FEEDS) return json({ error: 'feed_limit' }, 409);

  let url: string;
  try { url = parsePublicUrl(p.data.url).toString(); } catch (e: any) { return json({ error: 'blocked_url', detail: e.message }, 400); }

  let probe = await fetchFeed({ url });
  if (probe.kind === 'error') {
    // maybe it is a normal web page: look for <link rel="alternate" ...>
    try {
      const page = await safeFetch(url, { maxBytes: 1_000_000 });
      const found = discoverFeedUrl(new TextDecoder().decode(page.body), page.url);
      if (found) { url = found; probe = await fetchFeed({ url }); }
    } catch { /* fall through to the error below */ }
  }
  if (probe.kind !== 'ok') return json({ error: 'not_a_feed', detail: probe.kind === 'error' ? probe.error : 'no entries' }, 422);

  const { data: feed, error } = await admin.from('feeds').upsert(
    { user_id: user.id, url, title: probe.title, site_url: probe.siteUrl, etag: probe.etag, last_modified: probe.lastModified, fetch_interval_min: p.data.intervalMin ?? 60, last_fetched_at: new Date().toISOString(), next_fetch_at: new Date(Date.now() + 3600_000).toISOString() },
    { onConflict: 'user_id,url' },
  ).select('id,title').single();
  if (error || !feed) return json({ error: 'db_error' }, 500);

  await admin.from('feed_entries').upsert(probe.entries.map((e) => ({ ...e, feed_id: feed.id, user_id: user.id })), { onConflict: 'feed_id,guid', ignoreDuplicates: true });
  return json({ feed, entries: probe.entries.length }, 201);
}
