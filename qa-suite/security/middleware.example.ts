// Copy to <repo>/middleware.ts. Sets a per-request nonce CSP; Next 15 reads the nonce from the request's CSP header and stamps its own <script> tags.
import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, makeNonce } from './security/csp';

export function middleware(req: NextRequest) {
  const nonce = makeNonce();
  const csp = buildCsp({ nonce, isDev: process.env.NODE_ENV !== 'production', supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL });
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('content-security-policy', csp);
  return res;
}
// Skip static assets and the machine endpoints (webhooks/MCP/cron return JSON; a CSP on them is noise).
export const config = { matcher: [{ source: '/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/mcp|api/cron).*)', missing: [{ type: 'header', key: 'next-router-prefetch' }, { type: 'header', key: 'purpose', value: 'prefetch' }] }] };
