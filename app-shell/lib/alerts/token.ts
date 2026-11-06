import { createHmac, timingSafeEqual } from 'node:crypto';

/** Signed one-click unsubscribe links: HMAC(secret, "unsub:<watch id>"). Without ALERT_SIGNING_SECRET we cannot make a valid link, so we do not email. */
const secret = () => process.env.ALERT_SIGNING_SECRET ?? '';
export const signingConfigured = () => secret().length >= 16;

export function signWatch(watchId: string): string {
  return createHmac('sha256', secret()).update(`unsub:${watchId}`).digest('hex');
}
export function verifyWatchToken(watchId: string, token: string): boolean {
  if (!signingConfigured() || !/^[0-9a-f]{64}$/.test(token)) return false;
  const a = Buffer.from(signWatch(watchId), 'hex'), b = Buffer.from(token, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
export function unsubscribeUrl(site: string, watchId: string): string {
  return `${site}/api/prices/unsubscribe?w=${encodeURIComponent(watchId)}&t=${signWatch(watchId)}`;
}
