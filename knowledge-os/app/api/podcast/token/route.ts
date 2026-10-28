import { randomBytes } from 'node:crypto';
import { admin, json, requireUser } from '@/lib/server';

export const runtime = 'nodejs';
const url = (t: string) => `${process.env.APP_URL}/api/podcast/${t}/feed.xml`;

export async function GET(req: Request) {
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const { data } = await admin.from('podcast_feeds').select('token').eq('user_id', user.id).maybeSingle();
  return json({ feedUrl: data ? url(data.token) : null });
}

/** Rotate: the old URL stops working immediately (use if the link leaked). Subscribers must re-subscribe. */
export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const token = randomBytes(32).toString('base64url');
  const { error } = await admin.from('podcast_feeds').upsert({ user_id: user.id, token, rotated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) return json({ error: 'db_error' }, 500);
  return json({ feedUrl: url(token) });
}
