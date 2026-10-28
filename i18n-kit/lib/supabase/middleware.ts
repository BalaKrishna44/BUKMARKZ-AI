import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/** Paths (without the locale prefix) that need a signed-in user. */
const PROTECTED = [/^\/dashboard(\/|$)/];

export interface SessionOptions { path?: string; loginPath?: string }

export async function updateSession(req: NextRequest, { path = req.nextUrl.pathname, loginPath = '/login' }: SessionOptions = {}): Promise<NextResponse> {
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
  if (!user && PROTECTED.some((re) => re.test(path))) {
    const to = req.nextUrl.clone();
    to.pathname = loginPath; to.search = ''; to.searchParams.set('next', path + req.nextUrl.search);   // `next` stays locale-free; the login page adds the locale back
    const redirect = NextResponse.redirect(to);
    res.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }
  return res;
}
