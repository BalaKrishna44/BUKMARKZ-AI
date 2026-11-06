import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { safeNext } from '@/lib/safeNext';

/** Magic-link / OAuth landing: swaps the one-time `code` for a session cookie, then goes to `next` (same-site paths only). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const next = safeNext(url.searchParams.get('next'));
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL('/login?error=link', url.origin));
}
