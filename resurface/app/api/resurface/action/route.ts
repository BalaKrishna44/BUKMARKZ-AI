import { NextResponse, type NextRequest } from 'next/server';
import { admin, requireUser } from '@/lib/server';

export const runtime = 'nodejs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const res = (b: unknown, status = 200) => NextResponse.json(b, { status });

/** POST { action: 'open'|'archive'|'restore', itemId } | { action: 'quiz', resurfaceId, result: 'got'|'missed' } | { action: 'pause'|'resume' } */
export async function POST(req: NextRequest) {
  const o = req.headers.get('origin');
  if (o && o !== req.nextUrl.origin) return res({ error: 'forbidden' }, 403);               // cookie-authenticated write: same-origin only
  const user = await requireUser(req);
  if (!user) return res({ error: 'unauthorized' }, 401);
  const b = await req.json().catch(() => null);
  const action = b?.action;
  const now = new Date().toISOString();

  if (action === 'open' || action === 'archive' || action === 'restore') {
    if (typeof b.itemId !== 'string' || !UUID.test(b.itemId)) return res({ error: 'bad_request' }, 400);
    const patch = action === 'open' ? { last_opened_at: now } : { shelved_at: action === 'archive' ? now : null };
    const { data, error } = await admin.from('oneclist_items').update(patch).eq('id', b.itemId).eq('user_id', user.id).select('id');
    if (error) return res({ error: 'server_error' }, 500);
    return data?.length ? res({ ok: true }) : res({ error: 'not_found' }, 404);          // missing and someone else's look the same
  }
  if (action === 'quiz') {
    if (typeof b.resurfaceId !== 'string' || !UUID.test(b.resurfaceId) || !['got', 'missed'].includes(b.result)) return res({ error: 'bad_request' }, 400);
    const { data, error } = await admin.from('daily_resurface').update({ quiz_result: b.result }).eq('id', b.resurfaceId).eq('user_id', user.id).select('id');
    if (error) return res({ error: 'server_error' }, 500);
    return data?.length ? res({ ok: true }) : res({ error: 'not_found' }, 404);
  }
  if (action === 'pause' || action === 'resume') {
    const { error } = await admin.from('resurface_prefs').upsert({ user_id: user.id, enabled: action === 'resume', updated_at: now });
    return error ? res({ error: 'server_error' }, 500) : res({ ok: true });
  }
  return res({ error: 'bad_request' }, 400);
}
