import { admin, json, requireUser } from '@/lib/server';

/** Register / remove this browser for web-push price alerts. Body is the PushSubscription JSON from the browser. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const NS = { 'cache-control': 'no-store' };
const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://bukmarkz.com').replace(/\/$/, '');
const sameOrigin = (req: Request) => { const o = req.headers.get('origin'); return !o || o === SITE || o === new URL(req.url).origin; };

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403, NS);
  const user = await requireUser(req); if (!user) return json({ error: 'unauthorized' }, 401, NS);
  const b = await req.json().catch(() => null);
  const endpoint = b?.endpoint, p256dh = b?.keys?.p256dh, auth = b?.keys?.auth;
  if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 2048 || typeof p256dh !== 'string' || typeof auth !== 'string' || p256dh.length > 200 || auth.length > 100) return json({ error: 'bad_input' }, 400, NS);
  const { count } = await admin.from('push_subscriptions').select('id', { count: 'exact', head: true }).eq('user_id', user.id);
  if ((count ?? 0) >= 10) return json({ error: 'too_many_devices' }, 409, NS);
  const { error } = await admin.from('push_subscriptions').upsert({ user_id: user.id, endpoint, p256dh, auth }, { onConflict: 'endpoint' });
  return error ? json({ error: 'internal' }, 500, NS) : json({ ok: true }, 201, NS);
}
export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403, NS);
  const user = await requireUser(req); if (!user) return json({ error: 'unauthorized' }, 401, NS);
  const b = await req.json().catch(() => null);
  if (typeof b?.endpoint !== 'string') return json({ error: 'bad_input' }, 400, NS);
  await admin.from('push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', b.endpoint);
  return json({ ok: true }, 200, NS);
}
