/** Browser-side helpers for web push. Pure functions are unit-tested in test/push-client.test.ts. */
export function urlBase64ToUint8Array(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export type PushState = 'unsupported' | 'ios-needs-install' | 'denied' | 'off' | 'on';

export function isIos(ua = navigator.userAgent): boolean { return /iPad|iPhone|iPod/.test(ua); }
export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
}

export async function getPushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    // iPhone Safari only exposes push to a PWA added to the Home Screen
    return isIos() && !isStandalone() ? 'ios-needs-install' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

export async function enablePush(vapidPublicKey: string): Promise<PushState> {
  if (!vapidPublicKey) throw new Error('missing_vapid_key');
  const perm = await Notification.requestPermission(); // must be called from a user gesture
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource }));
  const res = await fetch('/api/push/subscribe', {
    method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(sub.toJSON()),
  });
  if (!res.ok) { // do not leave a browser subscription the server does not know about
    if (res.status !== 409) await sub.unsubscribe().catch(() => {});
    throw new Error(res.status === 409 ? 'too_many_devices' : 'subscribe_failed');
  }
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await fetch('/api/push/subscribe', {
      method: 'DELETE', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return 'off';
}
