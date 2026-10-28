import { admin } from '@/lib/server';
import { signedMp3Url } from '@/lib/podcast/r2';

export const runtime = 'nodejs';
const TOKEN = /^[A-Za-z0-9_-]{32,64}$/;
const UUID = /^[0-9a-f-]{36}$/i;

/** token + episode id -> 302 to a 15-minute signed R2 URL (R2 handles Range requests for seeking). */
async function handle(_req: Request, ctx: { params: Promise<{ token: string; id: string }> }) {
  const { token, id: raw } = await ctx.params;
  const id = raw.replace(/\.mp3$/i, '');
  if (!TOKEN.test(token) || !UUID.test(id)) return new Response('Not found', { status: 404 });
  const { data: feed } = await admin.from('podcast_feeds').select('user_id').eq('token', token).maybeSingle();
  if (!feed) return new Response('Not found', { status: 404 });
  const { data: ep } = await admin.from('podcast_episodes').select('audio_key').eq('id', id).eq('user_id', feed.user_id).eq('status', 'ready').maybeSingle();
  if (!ep?.audio_key) return new Response('Not found', { status: 404 });
  return new Response(null, { status: 302, headers: { location: await signedMp3Url(ep.audio_key), 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' } });
}
export { handle as GET, handle as HEAD };
