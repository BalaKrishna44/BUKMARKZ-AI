// middleware.ts — runs at the edge before every page request.
//   /dashboard  (no locale)  ->  307 to /<best locale>/dashboard   (saved cookie > browser language > country > en)
//   /de/dashboard            ->  served as is (an explicit URL always wins), after refreshing the Supabase session
import { NextResponse, type NextRequest } from 'next/server';
import { LOCALE_COOKIE, resolveLocale, splitLocale, withLocale } from './i18n';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const { locale: urlLocale, rest } = splitLocale(pathname);

  // 1) No locale in the URL: pick one and redirect, keeping the path and the query string.
  if (!urlLocale) {
    const locale = resolveLocale({
      cookie: req.cookies.get(LOCALE_COOKIE)?.value,
      acceptLanguage: req.headers.get('accept-language'),
      // Vercel sets x-vercel-ip-country, Cloudflare sets cf-ipcountry. (NextRequest.geo was removed in Next.js 15.)
      country: req.headers.get('x-vercel-ip-country') ?? req.headers.get('cf-ipcountry'),
    });
    const url = req.nextUrl.clone();
    url.pathname = withLocale(pathname, locale);        // search is kept by clone()
    const res = NextResponse.redirect(url, 307);        // 307: the answer depends on the visitor, so never 301
    res.headers.set('Vary', 'Accept-Language, Cookie');
    res.headers.set('Cache-Control', 'private, no-store');
    return res;
  }

  // 2) Locale present: run auth against the path WITHOUT the locale, and send signed-out users to the localized login page.
  return updateSession(req, { path: rest, loginPath: `/${urlLocale}/login` });
}

export const config = {
  // Skip Next internals, API routes, the OAuth callback (its URL is registered with the provider and must not change), SEO files and any file with an extension.
  matcher: ['/((?!api|auth|_next|_vercel|favicon\\.ico|robots\\.txt|sitemap\\.xml|manifest\\.webmanifest|.*\\..*).*)'],
};
