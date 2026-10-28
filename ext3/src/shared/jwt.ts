/** Light, dependency-free JWT helpers. They DO NOT verify signatures: the server does that (GET /api/ingest). */
const JWT_RE = /^[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}$/;

export const looksLikeJwt = (t: unknown): t is string => typeof t === 'string' && t.length <= 4096 && JWT_RE.test(t);

/** The `exp` claim in epoch seconds, or null when unreadable. */
export function jwtExp(token: string): number | null {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = new TextDecoder().decode(Uint8Array.from(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '=')), (c) => c.charCodeAt(0)));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp : null;
  } catch { return null; }
}
