/**
 * Security headers for Bukmarkz (Next.js 15, App Router). Pure functions, unit-tested in csp.test.ts.
 *
 * Allow-list reasons (keep this list SHORT; every entry is attack surface):
 *   Supabase  https://*.supabase.co + wss (auth, REST, realtime)          Stripe  js.stripe.com (script+frame), hooks.stripe.com (3DS frame), api.stripe.com
 *   YouTube   www.youtube-nocookie.com frames (Shorts feed embeds)          Images  https: because favicons/thumbnails come from any site the user saved
 * Not allowed on purpose: 'unsafe-eval' (prod), 'unsafe-inline' for SCRIPTS (nonce + strict-dynamic instead), object-src, framing of Bukmarkz by other sites.
 */
export interface CspOptions { nonce: string; isDev?: boolean; supabaseUrl?: string; reportUri?: string; embed?: boolean }

export function buildCsp({ nonce, isDev = false, supabaseUrl, reportUri, embed = false }: CspOptions): string {
  if (!/^[A-Za-z0-9+/_-]{16,}={0,2}$/.test(nonce)) throw new Error('nonce must be >=16 chars of base64/base64url');
  const sb = supabaseUrl ? new URL(supabaseUrl) : null;
  const sbHttp = sb ? sb.origin : 'https://*.supabase.co';
  const sbWs = sb ? `wss://${sb.host}` : 'wss://*.supabase.co';
  const d: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", 'https://js.stripe.com', ...(isDev ? ["'unsafe-eval'"] : [])],   // strict-dynamic makes browsers ignore the host entries; they are the fallback for old ones
    'style-src': ["'self'", "'unsafe-inline'"],            // Tailwind/Next inject inline <style>; style injection is far lower risk than script injection
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", sbHttp, sbWs, 'https://api.stripe.com', ...(isDev ? ['ws://localhost:*', 'http://localhost:*'] : [])],
    'frame-src': ['https://js.stripe.com', 'https://hooks.stripe.com', 'https://www.youtube-nocookie.com'],
    'media-src': ["'self'", 'https:', 'blob:'],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'self'", 'https://checkout.stripe.com'],
    // The ONLY route family other sites may frame is /embed/* (public stack widgets). Everything else stays unframeable (clickjacking).
    'frame-ancestors': embed ? ['https:', ...(isDev ? ['http://localhost:*'] : [])] : ["'none'"],
  };
  const parts = Object.entries(d).map(([k, v]) => `${k} ${v.join(' ')}`);
  if (!isDev) parts.push('upgrade-insecure-requests');
  if (reportUri) parts.push(`report-uri ${reportUri}`);
  return parts.join('; ');
}

/** Everything except CSP (which needs a per-request nonce). Apply to all routes via next.config.ts `headers()`. */
export const STATIC_SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },     // 2 years. Add `; preload` only AFTER every subdomain is HTTPS and you submit to hstspreload.org
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },                                                         // legacy twin of frame-ancestors 'none'
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(self "https://js.stripe.com"), usb=(), interest-cohort=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },                           // keeps OAuth popups working
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
];

/** Same as STATIC_SECURITY_HEADERS minus X-Frame-Options (which cannot allow "any site"; frame-ancestors in the CSP is what governs /embed/*). */
export const EMBED_SECURITY_HEADERS = STATIC_SECURITY_HEADERS.filter((h) => h.key !== 'X-Frame-Options');

/** 16 random bytes -> base64. Works in the Edge runtime (middleware) and in Node 20+. */
export function makeNonce(): string {
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  let s = ''; for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}
