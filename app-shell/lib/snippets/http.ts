/** CSRF guard for writes. Bearer-token callers (the extension) are not cookie-authenticated, so CSRF cannot apply to them. */
export function writeAllowed(req: Request): boolean {
  if ((req.headers.get('authorization') ?? '').startsWith('Bearer ')) return true;
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');
  const o = req.headers.get('origin');
  const sameOrigin = !o || o === new URL(req.url).origin || (site !== '' && o === site);
  return sameOrigin && (req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json');     // a cross-site <form> cannot send JSON
}
export const NO_STORE = { 'cache-control': 'private, no-store' } as const;
