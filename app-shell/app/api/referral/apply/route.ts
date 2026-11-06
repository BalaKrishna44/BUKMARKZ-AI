import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/** Called once by the NEW signed-in user (from the ?ref= cookie your signup flow stores). The database does all the checks. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  const code = typeof b?.code === 'string' ? b.code.trim().toLowerCase() : '';
  if (!/^[a-z0-9]{8}$/.test(code)) return NextResponse.json({ status: 'invalid' }, { status: 400 });
  const { data, error } = await (await createClient()).rpc('apply_referral', { p_code: code });
  if (error) return NextResponse.json({ status: 'error' }, { status: error.message.includes('not_authenticated') ? 401 : 500 });
  return NextResponse.json({ status: data });
}
