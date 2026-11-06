import { NextRequest, NextResponse } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { buildCsp, makeNonce } from '@/lib/security/csp';

/**
 * 1) Session refresh / login redirect (updateSession), 2) a per-request nonce Content-Security-Policy.
 * CSP_MODE=enforce turns the policy on. The default is REPORT-ONLY: violations are reported to /api/csp-report and nothing is blocked,
 * so watch it for ~48h (Stripe Checkout, OAuth popups, Shorts embeds, push) before enforcing.
 * Next 15 reads the nonce from the REQUEST's CSP header and stamps its own <script> tags with it.
 */
const ENFORCE = process.env.CSP_MODE === 'enforce';
const HEADER = ENFORCE ? 'content-security-policy' : 'content-security-policy-report-only';
const PUBLIC_STACK = /^\/s\/[^/]+$/;
const EMBED = /^\/embed\/[^/]+$/;        // widget pages: frameable by other sites, no session, no cookies   // public Stack pages skip the session refresh (see matcher), but still get the CSP

export async function middleware(req: NextRequest) {
  const nonce = makeNonce();
  const csp = buildCsp({ nonce, isDev: process.env.NODE_ENV !== 'production', supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, reportUri: ENFORCE ? undefined : '/api/csp-report', embed: EMBED.test(req.nextUrl.pathname) });
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set(HEADER, csp);
  const withNonce = new NextRequest(req, { headers });

  const res = PUBLIC_STACK.test(req.nextUrl.pathname) || EMBED.test(req.nextUrl.pathname) ? NextResponse.next({ request: withNonce }) : await updateSession(withNonce);
  res.headers.set(HEADER, csp);
  return res;
}
// Static files, the PWA files, SEO files and machine endpoints are skipped. Public Stack pages and their share image are handled above.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sw-push\\.js|manifest\\.webmanifest|sitemap\\.xml|robots\\.txt|api/webhooks|api/mcp|api/cron|api/csp-report|s/[^/]+/opengraph-image[^/]*$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
