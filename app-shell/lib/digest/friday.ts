import { createHmac, timingSafeEqual } from 'node:crypto';

/** Friday Vault After-Hours unsubscribe token: HMAC(secret, "friday:<user id>"). Must match supabase/functions/_shared/friday.ts signFriday(). Separate from the weekly digest token on purpose. */
const secret = () => process.env.ALERT_SIGNING_SECRET ?? '';
export const signFriday = (uid: string) => createHmac('sha256', secret()).update(`friday:${uid}`).digest('hex');
export function verifyFridayToken(uid: string, token: string): boolean {
  if (secret().length < 16 || !/^[0-9a-f]{64}$/.test(token)) return false;
  const a = Buffer.from(signFriday(uid), 'hex'), b = Buffer.from(token, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
