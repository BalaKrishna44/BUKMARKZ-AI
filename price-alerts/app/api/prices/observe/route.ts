import { NextRequest } from 'next/server';
import { admin } from '@/lib/server';
import { handleObserve } from '@/lib/prices/observe';
import { alertDb, defaultChannels } from '@/lib/alerts/default';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * POST /api/prices/observe   {url, price, currency}   Authorization: Bearer <Supabase access token>
 * Called by the extension for products the user is watching. No cookies, so no CSRF surface; extensions are not subject to CORS for manifest hosts.
 */
export async function POST(req: NextRequest) {
  try {
    const r = await handleObserve(
      { getUser: async (t) => { const { data, error } = await admin.auth.getUser(t); return error || !data.user ? null : { id: data.user.id }; }, db: alertDb, channels: defaultChannels() },
      req.headers.get('authorization'), await req.text());
    return Response.json(r.body, { status: r.status, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('observe failed', (e as Error).message);
    return Response.json({ code: 'server' }, { status: 500 });
  }
}
