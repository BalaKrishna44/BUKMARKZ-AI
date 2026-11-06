import { createHash, randomBytes } from 'node:crypto';
import { PLAN_LIMITS } from '../planLimits';
import { SITE as SITE_URL } from '../upgrade';
import { mcpLimitMessage, mcpWriteDeniedMessage } from './errors';

/**
 * Vault MCP authentication + metering.
 *
 *  Token format   buk_mcp_<43 chars base64url>   (32 random bytes). Only sha256(token) is stored.
 *  Tiers          caps come from PLAN_LIMITS (lib/planLimits.ts): free 50 calls / UTC month, read-only; pro and team 10,000 / month, read + write
 *  What is metered  `tools/call` only. initialize / tools/list / ping are free, so an IDE reconnecting never eats the free quota,
 *                   and invalid arguments or a refused write are not charged either (see protocol.ts for the order).
 *  Every tier also has a per-minute burst limit, so a looping agent cannot hammer embeddings and the database.
 */

export const TOKEN_PREFIX = 'buk_mcp_';
export const TOKEN_RE = /^buk_mcp_[A-Za-z0-9_-]{43}$/;
export type Tier = 'free' | 'pro';

export const TIERS: Record<Tier, { monthly: number | null; write: boolean; label: string }> = {
  free: { monthly: PLAN_LIMITS.free.mcp, write: false, label: 'Free' },
  pro: { monthly: PLAN_LIMITS.pro.mcp, write: true, label: 'Pro' },        // team shares the pro tier here: same caps, same write access
};
export const BURST_PER_MINUTE = 60;
export const SITE = SITE_URL;

export interface Principal { userId: string; tokenId: string; tier: Tier }
/** The only database surface this module needs; the Supabase service-role client satisfies it. */
export interface RpcDb { rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: { message: string } | null }> }

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** New secret. Show it to the user ONCE; afterwards only `prefix` (for recognition) and the hash exist. */
export function generateToken(): { token: string; prefix: string; hash: string } {
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  return { token, prefix: token.slice(TOKEN_PREFIX.length, TOKEN_PREFIX.length + 6), hash: hashToken(token) };
}

/** "Bearer buk_mcp_..." -> the token, or null for anything malformed (rejected before touching the database). */
export function parseBearer(header: string | null | undefined): string | null {
  const m = /^Bearer[ \t]+(\S+)$/i.exec((header ?? '').trim());
  return m && TOKEN_RE.test(m[1]) ? m[1] : null;
}

export type AuthResult = { ok: true; principal: Principal } | { ok: false; status: 401 | 503; message: string };

export async function authenticate(authorization: string | null | undefined, db: RpcDb): Promise<AuthResult> {
  const token = parseBearer(authorization);
  if (!token) return { ok: false, status: 401, message: 'Missing or malformed API token. Create one in Bukmarkz → Settings → Integrations; it starts with buk_mcp_.' };
  const { data, error } = await db.rpc('mcp_authenticate', { p_hash: hashToken(token) });
  if (error) return { ok: false, status: 503, message: 'Authentication is temporarily unavailable.' };
  const row = Array.isArray(data) ? data[0] : data;
  // Unknown, revoked and expired tokens are indistinguishable on purpose.
  if (!row || typeof row.user_id !== 'string') return { ok: false, status: 401, message: 'Invalid or revoked API token.' };
  return { ok: true, principal: { userId: row.user_id, tokenId: row.token_id, tier: row.tier === 'pro' ? 'pro' : 'free' } };
}

export type MeterResult =
  | { allowed: true; used: number; limit: number | null }
  | { allowed: false; reason: 'monthly'; used: number; limit: number }
  | { allowed: false; reason: 'burst'; retryAfter: number }
  | { allowed: false; reason: 'error' };

/** Count one tool call against the user's plan. Atomic in SQL, so parallel calls can't overshoot the limit. */
export async function meter(p: Principal, db: RpcDb): Promise<MeterResult> {
  const { data, error } = await db.rpc('mcp_meter', { p_user: p.userId, p_monthly_limit: TIERS[p.tier].monthly, p_burst_limit: BURST_PER_MINUTE });
  if (error || !data || typeof data !== 'object') return { allowed: false, reason: 'error' };     // fail closed: never serve unmetered
  if (data.allowed) return { allowed: true, used: Number(data.used) || 0, limit: data.limit ?? null };
  if (data.reason === 'burst') return { allowed: false, reason: 'burst', retryAfter: Math.max(1, Number(data.retry_after) || 30) };
  return { allowed: false, reason: 'monthly', used: Number(data.used) || 0, limit: Number(data.limit) || (TIERS.free.monthly as number) };
}

/** Give the request back when the failure was ours. Best effort. */
export async function refund(p: Principal, db: RpcDb): Promise<void> { try { await db.rpc('mcp_unmeter', { p_user: p.userId }); } catch { /* ignore */ } }

export function nextResetISO(now = new Date()): string { return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(); }

export const upgradeUrl = `${SITE}/pricing`;
export function limitMessage(used: number, limit: number, now = new Date(), tier: Tier = 'free'): string { return mcpLimitMessage(tier, used, limit, now); }
export const writeDeniedMessage = mcpWriteDeniedMessage;
