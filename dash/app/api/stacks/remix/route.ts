import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { baseSlug, withSuffix, HANDLE_RE } from '@/lib/stacks/slug';
import { SITE, getPublicStack } from '@/lib/stacks/public';
import { safeWrite, NO_STORE } from '@/lib/stacks/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,60}$/),
  handle: z.string().trim().toLowerCase().regex(HANDLE_RE, 'handle: 3-20 chars, a-z 0-9 _').optional(),     // only needed the first time the user publishes anything
}).strict();

const ERR: Record<string, [number, string]> = {
  not_authenticated: [401, 'Please sign in to remix.'], not_found: [404, 'This stack is no longer available.'],
  own_stack: [422, 'This is already your stack.'], handle_required: [422, 'Choose a creator handle to publish your remix under.'],
  handle_taken: [409, 'That handle is taken.'], too_many_stacks: [403, 'Stack limit reached.'], rate_limited: [429, 'Too many stacks today. Try again tomorrow.'],
};

/** POST /api/stacks/remix  { slug, handle? }  ->  201 { slug, url, count, remixedFrom }   One click: copies the stack into a new stack owned by the caller. */
export async function POST(req: NextRequest) {
  if (!safeWrite(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid', issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }, { status: 400, headers: NO_STORE });
  const { slug, handle } = parsed.data;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not_authenticated', message: ERR.not_authenticated[1] }, { status: 401, headers: NO_STORE });

  const original = await getPublicStack(slug);                      // only used to derive a readable URL for the copy; the RPC re-checks everything
  if (!original) return NextResponse.json({ error: 'not_found', message: ERR.not_found[1] }, { status: 404, headers: NO_STORE });

  const base = baseSlug(original.title);
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await supabase.rpc('remix_stack', { p_slug: slug, p_new_slug: withSuffix(base), p_handle: handle ?? null });
    if (!error) return NextResponse.json({ slug: data.slug, url: `${SITE}/s/${data.slug}`, count: data.count, remixedFrom: { slug: original.slug, handle: original.handle } }, { status: 201, headers: NO_STORE });
    const code = (error.message ?? '').trim();
    if (code === 'slug_taken') continue;                              // random suffix collided: just draw another
    const known = ERR[code];
    if (known) return NextResponse.json({ error: code, message: known[1] }, { status: known[0], headers: NO_STORE });
    console.error('remix_stack failed', error.code);                  // never log payloads
    return NextResponse.json({ error: 'server_error' }, { status: 500, headers: NO_STORE });
  }
  return NextResponse.json({ error: 'server_error' }, { status: 500, headers: NO_STORE });
}
