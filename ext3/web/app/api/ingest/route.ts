import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { handleIngest, type IngestDeps } from '@/lib/ingest';   // web/ingest.ts → lib/ingest.ts in your app

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The extension calls this with `Authorization: Bearer <Supabase access token>` and no cookies.
 * Rows are written with the USER's own token, so Postgres row-level security enforces ownership (no service-role key here).
 * Browser extensions are not subject to CORS for hosts in their manifest, so no CORS headers are needed or added.
 */
async function run(req: NextRequest, method: 'GET' | 'POST') {
  const auth = req.headers.get('authorization');
  const jwt = /^Bearer\s+(\S+)$/i.exec(auth ?? '')?.[1] ?? '';
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const db = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${jwt}` } } });

  const deps: IngestDeps = {
    getUser: async (t) => { const { data, error } = await db.auth.getUser(t); return error || !data.user ? null : { id: data.user.id, email: data.user.email ?? '' }; },
    find: async (userId, key) => {
      const { data } = await db.from('oneclist_items').select('id,note,tags').eq('user_id', userId).eq('url_key', key).maybeSingle();
      return data ? { id: data.id, note: data.note, tags: data.tags ?? [] } : null;
    },
    insert: async (row) => { const { data, error } = await db.from('oneclist_items').insert(row).select('id').single(); if (error) throw error; return data.id; },
    update: async (id, patch) => { const { error } = await db.from('oneclist_items').update(patch).eq('id', id); if (error) throw error; },
  };
  try {
    const text = method === 'POST' ? await req.text() : '';
    const r = await handleIngest(deps, auth, method, text);
    return Response.json(r.body, { status: r.status, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('ingest failed', (e as Error).message);          // never log the token or the body
    return Response.json({ code: 'server' }, { status: 500 });
  }
}
export const GET = (req: NextRequest) => run(req, 'GET');
export const POST = (req: NextRequest) => run(req, 'POST');
