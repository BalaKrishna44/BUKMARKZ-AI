// Edge-safe helpers for the OpenGraph card (no Node APIs).

const OK_TYPES = new Set(['image/png', 'image/jpeg']);          // what Satori can decode reliably (no webp/avif)
const MAX_BYTES = 300_000;

const b64 = (buf: ArrayBuffer) => {
  const u = new Uint8Array(buf); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};

/**
 * Fetch an (already origin-checked) avatar and inline it as a data URI. Satori would otherwise fetch remote <img> itself and
 * throw on a slow/404/odd-format image, which would turn the whole social card into an error. Any problem -> null -> initial letter.
 */
export async function avatarDataUri(url: string | null, fetchImpl: typeof fetch = fetch, timeoutMs = 2500): Promise<string | null> {
  if (!url) return null;
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, redirect: 'error', cache: 'force-cache' });      // no redirects: they could leave our origin
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!res.ok || !OK_TYPES.has(type)) return null;
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > MAX_BYTES) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return null;
    return `data:${type};base64,${b64(buf)}`;
  } catch { return null; } finally { clearTimeout(timer); }
}

export const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s);
/** Largest type that fits ~2 lines for the title length. Satori does not wrap by measuring, so we pick a tier. */
export const titleSize = (len: number) => (len <= 28 ? 88 : len <= 48 ? 72 : len <= 68 ? 58 : 48);
