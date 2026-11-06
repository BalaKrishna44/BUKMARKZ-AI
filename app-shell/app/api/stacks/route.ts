import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { baseSlug, validSlug, withSuffix, HANDLE_RE } from '@/lib/stacks/slug';
import { THEME_NAMES } from '@/lib/stacks/themes';
import { SITE } from '@/lib/stacks/public';

export const runtime = 'nodejs';

const Body = z.object({
  title: z.string().trim().min(3).max(80),
  description: z.string().trim().max(280).optional(),
  theme: z.enum(THEME_NAMES).default('mint'),
  slug: z.string().trim().toLowerCase().optional(),
  handle: z.string().trim().toLowerCase().regex(HANDLE_RE, 'handle: 3-20 chars, a-z 0-9 _').optional(),     // only needed for your first stack
  items: z.array(z.object({ id: z.string().uuid(), blurb: z.string().trim().max(200).optional() })).min(1).max(50),
}).strict();

const ERR: Record<string, [number, string]> = {
  not_authenticated: [401, 'Please sign in.'], handle_required: [422, 'Choose a creator handle for your first stack.'], handle_taken: [409, 'That handle is taken.'],
  slug_taken: [409, 'That URL is taken.'], no_valid_items: [422, 'None of the selected bookmarks can be published (private, scans and non-web links are excluded).'],
  too_many_stacks: [403, 'Stack limit reached.'], rate_limited: [429, 'Too many stacks today. Try again tomorrow.'],
};

/** Same-origin check for cookie-authenticated JSON writes (SameSite=Lax already blocks most CSRF; this closes the rest). */
function sameOrigin(req: NextRequest) {
  const o = req.headers.get('origin');
  return !o || o === req.nextUrl.origin || o === SITE;
}

/** POST /api/stacks  { title, description?, theme?, slug?, handle?, items:[{id, blurb?}] }  ->  201 { slug, url, count } */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid', issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }, { status: 400 });
  const b = parsed.data;

  const explicit = b.slug && b.slug.length > 0;
  if (explicit && !validSlug(b.slug!)) return NextResponse.json({ error: 'invalid_slug', message: 'URL: 3-60 chars, a-z 0-9 and single dashes; some words are reserved.' }, { status: 422 });
  const ids = new Set<string>(); const items = b.items.filter((i) => !ids.has(i.id) && ids.add(i.id));

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not_authenticated', message: ERR.not_authenticated[1] }, { status: 401 });

  // A chosen slug that is taken is the user's problem (409); an auto-generated one just gets a short random suffix.
  const base = explicit ? b.slug! : baseSlug(b.title);
  let slug = base;
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await supabase.rpc('create_stack', { p_title: b.title, p_description: b.description ?? null, p_theme: b.theme, p_slug: slug, p_handle: b.handle ?? null, p_items: items });
    if (!error) return NextResponse.json({ slug: data.slug, url: `${SITE}/s/${data.slug}`, count: data.count, handle: data.handle }, { status: 201 });
    const code = (error.message ?? '').trim();
    if (code === 'slug_taken' && !explicit && attempt < 3) { slug = withSuffix(base); continue; }
    const known = ERR[code];
    if (known) return NextResponse.json({ error: code, message: known[1] }, { status: known[0] });
    console.error('create_stack failed', error.code);                                  // never log payloads
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
  return NextResponse.json({ error: 'slug_taken', message: ERR.slug_taken[1] }, { status: 409 });
}

/** GET /api/stacks -> the signed-in user's stacks (RLS limits rows to the owner). */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  const { data, error } = await supabase.from('stacks').select('id,slug,title,theme,is_public,fork_count,created_at,stack_items(count)').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: 'server_error' }, { status: 500 });
  return NextResponse.json({ stacks: (data ?? []).map((s: any) => ({ ...s, item_count: s.stack_items?.[0]?.count ?? 0, stack_items: undefined, url: `${SITE}/s/${s.slug}` })) });
}
