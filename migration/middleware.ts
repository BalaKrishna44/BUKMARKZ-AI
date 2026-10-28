import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { extractLegacyToken } from '@/lib/legacy/verify';

/**
 * 1. Keeps the Supabase session fresh (standard @supabase/ssr pattern).
 * 2. If there is no Supabase session but the request carries a legacy Knox token, swap it for a real Supabase session
 *    (via /api/auth/legacy-exchange, which runs on Node and talks to Django) and continue as that user.
 * Edge-safe: no database driver here.
 */
const cache = new Map<string, { s: { access_token: string; refresh_token: string }; until: number }>(); // per isolate, short-lived

async function sha256(s: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function middleware(req: NextRequest) {
  // The exchange route is called from this middleware: never intercept it or it would call itself forever.
  if (req.nextUrl.pathname === '/api/auth/legacy-exchange') return NextResponse.next();
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
  if (user) return res;

  const legacy = extractLegacyToken(req.headers.get('authorization'));
  if (!legacy) return res;
  const isApi = req.nextUrl.pathname.startsWith('/api/');
  const fail = (status: number, code: string) => (isApi ? NextResponse.json({ code }, { status }) : res);

  const key = await sha256(legacy);                       // cache key is a hash, never the token
  let tokens = cache.get(key) && cache.get(key)!.until > Date.now() ? cache.get(key)!.s : null;
  if (!tokens) {
    let r: Response;
    try {
      r = await fetch(new URL('/api/auth/legacy-exchange', req.url), {
        method: 'POST', headers: { authorization: `Token ${legacy}`, 'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '' },
        signal: AbortSignal.timeout(8000),
      });
    } catch { return fail(503, 'unavailable'); }
    if (!r.ok) return fail(r.status, ((await r.json().catch(() => ({}))) as any).code ?? 'invalid_token');
    const j = (await r.json()) as { access_token: string; refresh_token: string; expires_in: number };
    tokens = { access_token: j.access_token, refresh_token: j.refresh_token };
    if (cache.size > 500) cache.clear();
    cache.set(key, { s: tokens, until: Date.now() + Math.min(10 * 60_000, Math.max(0, (j.expires_in - 60) * 1000)) });
  }

  // Installs the session: setAll() above writes the cookies on this request AND on the response, so the browser keeps it.
  const { error } = await supabase.auth.setSession(tokens);
  if (error) { cache.delete(key); return fail(401, 'invalid_token'); }
  return res;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'] };
