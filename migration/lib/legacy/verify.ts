import { createHash } from 'node:crypto';

export interface LegacyUser { id: number; email: string }

/** Knox tokens are 64 hex chars by default; JWTs (Supabase) contain dots. Loose bounds, strict charset. */
const TOKEN_RE = /^[A-Za-z0-9]{32,128}$/;

/** Pulls a candidate Knox token from `Authorization: Token <t>` or `Bearer <t>` (never from URL or body). */
export function extractLegacyToken(authorization: string | null | undefined): string | null {
  const m = /^(Token|Bearer)\s+(\S+)$/i.exec((authorization ?? '').trim());
  if (!m || m[2].includes('.')) return null;           // dotted = a JWT, not ours to handle
  return TOKEN_RE.test(m[2]) ? m[2] : null;
}

export class VerifyUnavailable extends Error {}

/**
 * PROXY mode (default, recommended): ask Django itself. Django applies its own expiry, is_active and Knox version rules,
 * and no Django database credentials ever reach Next.js. Returns null for an invalid/expired token.
 */
export async function verifyViaDjango(token: string, base = process.env.DJANGO_API_URL, fetchImpl: typeof fetch = fetch): Promise<LegacyUser | null> {
  if (!base) throw new VerifyUnavailable('DJANGO_API_URL not set');
  let res: Response;
  try {
    res = await fetchImpl(`${base.replace(/\/$/, '')}/api/auth/user/`, {
      headers: { Authorization: `Token ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(4000), cache: 'no-store',
    });
  } catch { throw new VerifyUnavailable('Django unreachable'); }
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new VerifyUnavailable(`Django ${res.status}`);
  const u: any = await res.json().catch(() => null);
  return u && Number.isInteger(u.id) && typeof u.email === 'string' && u.email ? { id: u.id, email: u.email.toLowerCase() } : null;
}

/** Knox stores sha512(token) hex as the primary key of knox_authtoken (no salt, Knox ≥ 4). */
export const knoxDigest = (token: string) => createHash('sha512').update(token, 'utf8').digest('hex');

/** DB mode SQL: run it with a READ-ONLY role limited to these two tables. */
export const KNOX_LOOKUP_SQL = `select u.id, u.email from knox_authtoken t join accounts_customuser u on u.id = t.user_id
  where t.digest = $1 and (t.expiry is null or t.expiry > now()) and u.is_active`;

/** DB mode (optional): needs `npm i pg` and DJANGO_DB_URL. Does not renew expiry like Knox's AUTO_REFRESH would. */
export async function verifyViaDb(token: string): Promise<LegacyUser | null> {
  const url = process.env.DJANGO_DB_URL; if (!url) throw new VerifyUnavailable('DJANGO_DB_URL not set');
  const { Pool } = await import('pg' as string);
  const pool = (globalThis as any).__legacyPool ??= new Pool({ connectionString: url, max: 3, statement_timeout: 3000 });
  const { rows } = await pool.query(KNOX_LOOKUP_SQL, [knoxDigest(token)]);
  return rows[0] ? { id: rows[0].id, email: String(rows[0].email).toLowerCase() } : null;
}

export const verifyLegacyToken = (token: string) => (process.env.LEGACY_VERIFY_MODE === 'db' ? verifyViaDb(token) : verifyViaDjango(token));
