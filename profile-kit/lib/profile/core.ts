// Pure helpers for the avatar route (no framework imports, so they run under plain Node tests).
export const MAX_UPLOAD = 2 * 1024 * 1024;          // 2 MB in
export const SIZE = 256;                              // px out
export const MIN_INTERVAL_MS = 5_000;                 // per-user pause between uploads

export type ImageKind = 'jpeg' | 'png' | 'webp';
/** Decide the type from the first bytes, never from the file name or the browser-supplied MIME type. */
export function sniffImage(b: Uint8Array): ImageKind | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  return null;
}

/** Cookie-authenticated writes must come from our own pages (CSRF). Bearer-token clients (mobile, extension) are exempt. */
export function sameOriginOrBearer(req: Request): boolean {
  if ((req.headers.get('authorization') ?? '').startsWith('Bearer ')) return true;
  const sfs = req.headers.get('sec-fetch-site');
  if (sfs) return sfs === 'same-origin';
  const origin = req.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).host === new URL(req.url).host; } catch { return false; }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Storage object path: <user id>/<16 hex chars of the image hash>.jpg. The hash makes every upload a new address, so caches never serve a stale picture. */
export function avatarPath(userId: string, hash: string): string | null {
  return UUID.test(userId) && /^[0-9a-f]{16}$/.test(hash) ? `${userId}/${hash}.jpg` : null;
}

/** The public address we store: exactly our own Storage origin + the avatars bucket + a path we generated. */
export function publicAvatarUrl(supabaseUrl: string, path: string): string | null {
  try {
    const base = new URL(supabaseUrl);
    if (base.protocol !== 'https:' && base.hostname !== 'localhost') return null;
    return `${base.origin}/storage/v1/object/public/avatars/${path}`;
  } catch { return null; }
}

/** Turn a stored address back into the object path, but only if it belongs to this user. */
export function pathFromUrl(url: string | null | undefined, userId: string): string | null {
  if (!url) return null;
  const m = url.match(/\/storage\/v1\/object\/public\/avatars\/([0-9a-f-]{36}\/[0-9a-f]{16}\.jpg)$/);
  return m && m[1].startsWith(userId + '/') ? m[1] : null;
}
