import { createHash } from 'node:crypto';
import { admin } from '../server';
import { buildPodcastXml } from './xml';

export const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
const noindex = { 'x-robots-tag': 'noindex, nofollow, noarchive', 'cache-control': 'private, max-age=300' };

/** Shared by /api/podcast/[token]/feed.xml and /api/podcast/rss?token=. The token in the URL IS the credential (podcast apps cannot send headers). */
export async function renderFeed(req: Request, token: string, selfUrl: string): Promise<Response> {
  if (!TOKEN_RE.test(token)) return new Response('Not found', { status: 404, headers: noindex });
  const { data: feed, error: fe } = await admin.from('podcast_feeds').select('user_id,title,description').eq('token', token).maybeSingle();
  if (fe) return new Response('Service unavailable', { status: 503, headers: { ...noindex, 'retry-after': '60' } });
  if (!feed) return new Response('Not found', { status: 404, headers: noindex });

  const { data: eps, error: ee } = await admin.from('podcast_episodes')
    .select('id,title,description,published_at,audio_bytes,duration_sec')
    .eq('user_id', feed.user_id).eq('status', 'ready').order('published_at', { ascending: false }).limit(100);
  if (ee) return new Response('Service unavailable', { status: 503, headers: { ...noindex, 'retry-after': '60' } });

  const base = process.env.APP_URL!;
  const list = eps ?? [];
  const xml = buildPodcastXml(
    { title: feed.title, description: feed.description, link: base, selfUrl, imageUrl: process.env.PODCAST_IMAGE_URL, category: process.env.PODCAST_CATEGORY ?? 'Technology', ownerEmail: process.env.PODCAST_OWNER_EMAIL, lastBuild: list[0]?.published_at ? new Date(list[0].published_at) : undefined },
    list.map((e) => ({
      id: e.id, title: e.title, description: e.description, publishedAt: new Date(e.published_at),
      audioUrl: `${base}/api/podcast/${token}/ep/${e.id}.mp3`, bytes: Number(e.audio_bytes ?? 0), durationSec: e.duration_sec ?? 0,
    })),
  );
  const etag = `"${createHash('sha1').update(xml).digest('hex')}"`;
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag, ...noindex } });
  return new Response(xml, { headers: { 'content-type': 'application/rss+xml; charset=utf-8', etag, ...noindex } });
}
