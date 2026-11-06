import { NextResponse, type NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { THEME_NAMES } from '@/lib/stacks/themes';

export const runtime = 'nodejs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const Patch = z.object({
  title: z.string().trim().min(3).max(80).optional(), description: z.string().trim().max(280).nullable().optional(),
  theme: z.enum(THEME_NAMES).optional(), is_public: z.boolean().optional(),
}).strict().refine((o) => Object.keys(o).length > 0, 'nothing to update');

async function owner(req: NextRequest, id: string) {
  const o = req.headers.get('origin');
  if (o && o !== req.nextUrl.origin) return { res: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  if (!UUID.test(id)) return { res: NextResponse.json({ error: 'not_found' }, { status: 404 }) };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { res: NextResponse.json({ error: 'not_authenticated' }, { status: 401 }) };
  return { supabase, user };
}

/** PATCH /api/stacks/:id  { title?, description?, theme?, is_public? }  (unpublish = is_public:false). Slug and items are fixed once published. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const o = await owner(req, id); if (o.res) return o.res;
  const p = Patch.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const { data, error } = await o.supabase!.from('stacks').update({ ...p.data, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', o.user!.id).select('slug').maybeSingle();
  if (error) return NextResponse.json({ error: 'server_error' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });          // missing and someone else's look the same
  revalidateTag(`stack:${data.slug}`);
  return NextResponse.json({ ok: true, slug: data.slug });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const o = await owner(req, id); if (o.res) return o.res;
  const { data, error } = await o.supabase!.from('stacks').delete().eq('id', id).eq('user_id', o.user!.id).select('slug').maybeSingle();
  if (error) return NextResponse.json({ error: 'server_error' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  revalidateTag(`stack:${data.slug}`);
  return NextResponse.json({ ok: true });
}
