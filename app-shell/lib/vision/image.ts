import type { ImageMime } from './providers';

/** Decide the type from the bytes, never from the client's Content-Type. null => unsupported (e.g. HEIC). */
export function sniffImage(b: Uint8Array): ImageMime | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp';
  if (b.length > 6 && String.fromCharCode(...b.slice(0, 4)) === 'GIF8') return 'image/gif';
  return null;
}
