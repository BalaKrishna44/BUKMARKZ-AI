import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { safeWrite, NO_STORE } from '@/lib/stacks/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Slug = z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,60}$/);
const Body = z.object({ slug: Slug }).strict();
const ERR: Record<string, [number, string]> = {
  not_authenticated: [401, 'Please sign in to follow stacks.'], not_found: [404, 'This stack is no longer available.'],
  own_stack: [422, 'You can’t follow your own stack.'], too_many_follows: [403, 'You’re following the maximum of 500 stacks.'],
};
const fail = (code: string) => { const k = ERR[code]; return k ? NextResponse.json({ error: code, message: k[1] }, { status: k[0], headers: NO_STORE }) : (console.error('follow rpc failed', code), NextResponse.json({ error: 'server_error' }, { status: 500, headers: NO_STORE })); };

/** GET /api/stacks/follow?slug=x -> { authed, own, following, follower_count }. Per-viewer, so never cached (the public page itself stays ISR). */
export async function GET(req: NextRequest) {
  const slug = Slug.safeParse(req.nextUrl.searchParams.get('slug'));
  if (!slug.success) return NextResponse.json({ error: 'invalid' }, { status: 400, headers: NO_STORE });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('stack_viewer_state', { p_slug: slug.data });
  if (error) return fail((error.message ?? '').trim());
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
  return NextResponse.json(data, { headers: NO_STORE });
}

async function change(req: NextRequest, fn: 'follow_stack' | 'unfollow_stack') {
  if (!safeWrite(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400, headers: NO_STORE });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail('not_authenticated');
  const { data, error } = await supabase.rpc(fn, { p_slug: parsed.data.slug });
  if (error) return fail((error.message ?? '').trim());
  return NextResponse.json(data, { headers: NO_STORE });
}
/** POST { slug } -> follow (idempotent).  DELETE { slug } -> unfollow (idempotent). */
export const POST = (req: NextRequest) => change(req, 'follow_stack');
export const DELETE = (req: NextRequest) => change(req, 'unfollow_stack');
