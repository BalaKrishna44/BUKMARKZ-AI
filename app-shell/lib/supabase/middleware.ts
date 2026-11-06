import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/** Paths that need a signed-in user. Everything else (landing page, /login, /auth/*) stays public. */
const PROTECTED = [/^\/dashboard(\/|$)/];

/**
 * Standard @supabase/ssr middleware: refreshes the auth cookies on every request (so Server Components see a live session)
 * and sends signed-out visitors of protected pages to /login?next=... . getUser() asks Supabase to verify the JWT; getSession() would only decode the cookie.
 * If your project already has a middleware (e.g. the legacy-token exchange), call updateSession() first and keep its response.
 */
export async function updateSession(req: NextRequest): Promise<NextResponse> {
  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user && PROTECTED.some((re) => re.test(req.nextUrl.pathname))) {
    const to = req.nextUrl.clone();
    to.pathname = '/login'; to.search = ''; to.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search);
    const redirect = NextResponse.redirect(to);
    res.cookies.getAll().forEach((c) => redirect.cookies.set(c));      // keep any cookie the refresh attempt cleared
    return redirect;
  }
  return res;
}
