// Pure helpers for account deletion.
export const REAUTH_WINDOW_MS = 30 * 60 * 1000;

/** Deletion is destructive and irreversible: cookie sessions from our own pages only. Bearer tokens (extension, mobile, MCP) can never delete an account. */
export function sameOriginOnly(req: Request): boolean {
  if ((req.headers.get('authorization') ?? '').startsWith('Bearer ')) return false;
  const sfs = req.headers.get('sec-fetch-site');
  if (sfs) return sfs === 'same-origin';
  const origin = req.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).host === new URL(req.url).host; } catch { return false; }
}

/** The user must have signed in recently, so a stolen or forgotten open session cannot erase the account. */
export function recentlySignedIn(lastSignInAt: string | null | undefined, now = Date.now()): boolean {
  const t = lastSignInAt ? Date.parse(lastSignInAt) : NaN;
  return Number.isFinite(t) && now - t >= -60_000 && now - t <= REAUTH_WINDOW_MS;
}

/** Typed confirmation: the word DELETE and the account's own email address. */
export function confirmationOk(body: unknown, email: string | null | undefined): boolean {
  if (!body || typeof body !== 'object' || !email) return false;
  const b = body as { confirm?: unknown; email?: unknown };
  return b.confirm === 'DELETE' && typeof b.email === 'string' && b.email.trim().toLowerCase() === email.trim().toLowerCase();
}

export const BUCKETS = ['avatars', 'archives'] as const;
