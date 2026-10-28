import { createHash } from 'node:crypto';
import { admin } from '@/lib/server';
import { buildPodcastXml } from '@/lib/podcast/xml';

export const runtime = 'nodejs';
const TOKEN = /^[A-Za-z0-9_-]{32,64}$/;
const noindex = { 'x-robots-tag': 'noindex, nofollow, noarchive', 'cache-control': 'private, max-age=300' };

/** Private RSS. The token in the URL is the credential: podcast apps cannot send headers. */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!TOKEN.test(token)) return new Response('Not found', { status: 404, headers: noindex });
  const { data: feed } = await admin.from('podcast_feeds').select('user_id,title,description').eq('token', token).maybeSingle();
  if (!feed) return new Response('Not found', { status: 404, headers: noindex });

  const { data: eps } = await admin.from('podcast_episodes')
    .select('id,title,description,published_at,audio_bytes,duration_sec')
    .eq('user_id', feed.user_id).eq('status', 'ready').order('published_at', { ascending: false }).limit(100);

  const base = process.env.APP_URL!;
  const xml = buildPodcastXml(
    { title: feed.title, description: feed.description, link: base, selfUrl: `${base}/api/podcast/${token}/feed.xml` },
    (eps ?? []).map((e) => ({
      id: e.id, title: e.title, description: e.description, publishedAt: new Date(e.published_at),
      audioUrl: `${base}/api/podcast/${token}/ep/${e.id}.mp3`, bytes: Number(e.audio_bytes ?? 0), durationSec: e.duration_sec ?? 0,
    })),
  );
  const etag = `"${createHash('sha1').update(xml).digest('hex')}"`;
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag, ...noindex } });
  return new Response(xml, { headers: { 'content-type': 'application/rss+xml; charset=utf-8', etag, ...noindex } });
}
