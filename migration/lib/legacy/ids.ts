import { createHash } from 'node:crypto';

/** MUST equal NAMESPACE in migrate_django_to_supabase.py. */
export const LEGACY_NAMESPACE = 'b6dfa928-e339-45fd-9965-428a1b73993b';

/** RFC 4122 UUID v5 (SHA-1), identical to Python's uuid.uuid5(NAMESPACE, name). */
export function uuid5(name: string, namespace = LEGACY_NAMESPACE): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const h = createHash('sha1').update(ns).update(Buffer.from(name, 'utf8')).digest().subarray(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
export const legacyUserUuid = (djangoId: number | string) => uuid5(`bukmarkz-legacy-user-${Number(djangoId)}`);
