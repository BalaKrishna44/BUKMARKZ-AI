import { money, type Alert, type NotifyDb } from './notify';

/**
 * Web push via the `web-push` package (npm i web-push). Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT ("mailto:support@bukmarkz.com").
 * Subscriptions the push service reports as gone (404/410) are deleted. Succeeds if at least one device accepted the message.
 */
export interface PushSub { id: string; endpoint: string; p256dh: string; auth: string }
export interface PushTransport { send(sub: PushSub, payload: string): Promise<{ statusCode: number }> }

async function webPushTransport(): Promise<PushTransport | null> {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY, subject = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subject) return null;
  const wp: any = await import(/* webpackIgnore: true */ 'web-push' as string);
  wp.setVapidDetails(subject, pub, priv);
  return { async send(sub, payload) {
    try { const r = await wp.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 86_400, urgency: 'normal' }); return { statusCode: r.statusCode }; }
    catch (e: any) { return { statusCode: Number(e?.statusCode) || 0 }; }
  } };
}

export function makePush(db: NotifyDb & { from(t: string): any }, transport?: PushTransport | null) {
  let t: PushTransport | null | undefined = transport;
  return async function push(a: Alert): Promise<boolean> {
    if (t === undefined) t = await webPushTransport();
    if (!t) return false;
    const { data: subs, error } = await db.from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('user_id', a.claim.user_id).limit(10);
    if (error || !subs?.length) return false;
    const site = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://bukmarkz.com').replace(/\/$/, '');
    const payload = JSON.stringify({ title: 'Price drop', body: `${(a.claim.title ?? 'A product you watch').slice(0, 80)} is now ${money(a.price, a.claim.currency)}`, url: `${site}/dashboard?item=${a.claim.item_id}`, tag: a.claim.watch_id });
    let any = false;
    for (const s of subs as PushSub[]) {
      const r = await t.send(s, payload);
      if (r.statusCode >= 200 && r.statusCode < 300) { any = true; await db.from('push_subscriptions').update({ last_success_at: new Date().toISOString() }).eq('id', s.id); }
      else if (r.statusCode === 404 || r.statusCode === 410) await db.from('push_subscriptions').delete().eq('id', s.id);
    }
    return any;
  };
}
