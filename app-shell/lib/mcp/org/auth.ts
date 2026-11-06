import { createHash, randomBytes } from 'node:crypto';

/**
 * Workspace (organization) MCP tokens.   buk_org_<43 chars base64url>, only sha256(token) is stored.
 * A token belongs to ONE workspace and acts only inside it. It is valid only while the admin who created it is still an admin of that
 * workspace (enforced in SQL by org_mcp_authenticate), so removing or demoting a person switches off everything they minted.
 * Personal tokens (buk_mcp_) are rejected here and workspace tokens are rejected by the personal endpoint: the prefixes never overlap.
 */
export const ORG_TOKEN_PREFIX = 'buk_org_';
export const ORG_TOKEN_RE = /^buk_org_[A-Za-z0-9_-]{43}$/;
export const ORG_BURST_PER_MINUTE = 60;
export const ORG_MONTHLY_PER_SEAT = () => { const n = Number(process.env.ORG_MCP_MONTHLY_PER_SEAT); return Number.isInteger(n) && n > 0 ? n : 10_000; };

export interface OrgPrincipal { orgId: string; orgName: string; tokenId: string; createdBy: string; scopes: string[]; seatLimit: number }
export interface RpcDb { rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: { message: string } | null }> }

export const hashOrgToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function generateOrgToken(): { token: string; prefix: string; hash: string } {
  const token = ORG_TOKEN_PREFIX + randomBytes(32).toString('base64url');
  return { token, prefix: token.slice(ORG_TOKEN_PREFIX.length, ORG_TOKEN_PREFIX.length + 6), hash: hashOrgToken(token) };
}

export function parseOrgBearer(header: string | null | undefined): string | null {
  const m = /^Bearer[ \t]+(\S+)$/i.exec((header ?? '').trim());
  return m && ORG_TOKEN_RE.test(m[1]) ? m[1] : null;
}

export type OrgAuthResult = { ok: true; principal: OrgPrincipal } | { ok: false; status: 401 | 503; message: string };

export async function authenticateOrg(authorization: string | null | undefined, db: RpcDb): Promise<OrgAuthResult> {
  const token = parseOrgBearer(authorization);
  if (!token) return { ok: false, status: 401, message: 'Missing or malformed workspace token. Workspace admins can create one in Bukmarkz → Workspace → Integrations; it starts with buk_org_.' };
  const { data, error } = await db.rpc('org_mcp_authenticate', { p_hash: hashOrgToken(token) });
  if (error) return { ok: false, status: 503, message: 'Authentication is temporarily unavailable.' };
  const row = Array.isArray(data) ? data[0] : data;
  // Unknown, revoked, expired, and "creator is no longer an admin" are indistinguishable on purpose.
  if (!row || typeof row.org_id !== 'string' || typeof row.token_id !== 'string') return { ok: false, status: 401, message: 'Invalid or revoked workspace token.' };
  const scopes = Array.isArray(row.scopes) ? row.scopes.filter((s: unknown): s is string => typeof s === 'string') : [];
  return { ok: true, principal: { orgId: row.org_id, orgName: String(row.org_name ?? ''), tokenId: row.token_id, createdBy: String(row.created_by ?? ''), scopes, seatLimit: Math.max(1, Number(row.seat_limit) || 1) } };
}

export type OrgMeterResult =
  | { allowed: true; used: number; limit: number }
  | { allowed: false; reason: 'monthly'; used: number; limit: number }
  | { allowed: false; reason: 'burst'; retryAfter: number }
  | { allowed: false; reason: 'error' };

/** Atomic in SQL. Fails closed: if we cannot count the call, we do not serve it. */
export async function meterOrg(p: OrgPrincipal, db: RpcDb): Promise<OrgMeterResult> {
  const limit = ORG_MONTHLY_PER_SEAT() * p.seatLimit;
  const { data, error } = await db.rpc('org_mcp_meter', { p_org: p.orgId, p_token: p.tokenId, p_monthly_limit: limit, p_burst_limit: ORG_BURST_PER_MINUTE });
  if (error || !data || typeof data !== 'object') return { allowed: false, reason: 'error' };
  if (data.allowed) return { allowed: true, used: Number(data.used) || 0, limit };
  if (data.reason === 'burst') return { allowed: false, reason: 'burst', retryAfter: Math.max(1, Number(data.retry_after) || 30) };
  return { allowed: false, reason: 'monthly', used: Number(data.used) || 0, limit };
}
export async function refundOrg(p: OrgPrincipal, db: RpcDb): Promise<void> { try { await db.rpc('org_mcp_unmeter', { p_org: p.orgId }); } catch { /* best effort */ } }
