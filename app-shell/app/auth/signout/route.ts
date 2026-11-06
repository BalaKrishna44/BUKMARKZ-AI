import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/** POST only, same-origin only (a cross-site form must not be able to sign people out). */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const origin = req.headers.get('origin');
  if (origin && origin !== url.origin) return new NextResponse('Forbidden', { status: 403 });
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', url.origin), 303);
}
