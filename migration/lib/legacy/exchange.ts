import { legacyUserUuid } from './ids';
import { VerifyUnavailable, type LegacyUser } from './verify';

export interface SessionTokens { access_token: string; refresh_token: string; expires_in: number; expires_at?: number }
export type ExchangeResult =
  | { ok: true; session: SessionTokens; userId: string }
  | { ok: false; status: 401 | 409 | 410 | 429 | 503; code: 'invalid_token' | 'not_migrated' | 'sunset' | 'rate_limited' | 'unavailable' };

export interface ExchangeDeps {
  verify(token: string): Promise<LegacyUser | null>;
  admin: { getUserById(id: string): Promise<{ data: { user: { id: string; email?: string | null } | null }; error: any }>;
           generateLink(a: { type: 'magiclink'; email: string }): Promise<{ data: { properties?: { hashed_token?: string } } | null; error: any }> };
  verifyOtp(a: { type: 'magiclink'; token_hash: string }): Promise<{ data: { session: SessionTokens | null }; error: any }>;
  now?: () => number;
  sunset?: string | undefined;   // ISO date: after this, legacy tokens stop working
  limiter?: (key: string) => boolean;   // true = allowed
  audit?: (event: string, f: Record<string, unknown>) => void;
}

/**
 * Trade a VALID legacy Knox token for a real Supabase session.
 *  • The Supabase user must already exist (created by the migration script). We never create accounts here:
 *    generateLink() would silently create one, so we look the user up first by its deterministic id.
 *  • The email Django reports must equal the migrated account's email, otherwise we refuse (account changed since migration).
 *  • The raw token is never logged or returned.
 */
export async function exchangeLegacyToken(d: ExchangeDeps, token: string, clientKey: string): Promise<ExchangeResult> {
  const now = d.now?.() ?? Date.now(), audit = d.audit ?? (() => {});
  if (d.sunset && now > Date.parse(d.sunset)) return { ok: false, status: 410, code: 'sunset' };
  if (d.limiter && !d.limiter(clientKey)) return { ok: false, status: 429, code: 'rate_limited' };

  let legacy: LegacyUser | null;
  try { legacy = await d.verify(token); } catch (e) { if (e instanceof VerifyUnavailable) return { ok: false, status: 503, code: 'unavailable' }; throw e; }
  if (!legacy) { audit('legacy_exchange_rejected', { client: clientKey }); return { ok: false, status: 401, code: 'invalid_token' }; }

  const id = legacyUserUuid(legacy.id);
  const { data: found, error } = await d.admin.getUserById(id);
  if (error || !found.user) { audit('legacy_exchange_not_migrated', { legacyId: legacy.id }); return { ok: false, status: 409, code: 'not_migrated' }; }
  if ((found.user.email ?? '').toLowerCase() !== legacy.email) { audit('legacy_exchange_email_mismatch', { legacyId: legacy.id }); return { ok: false, status: 409, code: 'not_migrated' }; }

  const link = await d.admin.generateLink({ type: 'magiclink', email: found.user.email! });
  const hashed = link.data?.properties?.hashed_token;
  if (link.error || !hashed) return { ok: false, status: 503, code: 'unavailable' };
  const { data, error: otpErr } = await d.verifyOtp({ type: 'magiclink', token_hash: hashed });
  if (otpErr || !data.session) return { ok: false, status: 503, code: 'unavailable' };
  audit('legacy_exchange_ok', { userId: id });
  return { ok: true, session: data.session, userId: id };
}

/** Per-instance sliding-window limiter. On serverless use a shared store (Upstash/Redis) for a real limit. */
export function memoryLimiter(max = 20, windowMs = 60_000) {
  const hits = new Map<string, number[]>();
  return (key: string) => {
    const t = Date.now(), arr = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
    if (arr.length >= max) { hits.set(key, arr); return false; }
    arr.push(t); hits.set(key, arr);
    if (hits.size > 5000) hits.clear();
    return true;
  };
}
