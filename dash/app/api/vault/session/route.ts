import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { saveSessionCore } from '@/lib/sessions/core';
import { sessionDeps } from '@/lib/sessions/deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY = 700_000;                                // 200 tabs x (2 KB url + 200 title + 512 icon) is well under this

/**
 * POST /api/vault/session   Authorization: Bearer <Supabase access token>   body: { tabs: [{url,title,favicon}], title? }
 * The extension's "Flush Session". Same auth model as /api/ingest: the row is written with the USER's token, so RLS enforces ownership; no service role here.
 * The extension closes tabs only after it receives { ok: true }, so every failure path answers with a non-2xx status.
 */
export async function POST(req: NextRequest) {
  const jwt = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1] ?? '';
  if (!jwt) return Response.json({ code: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  const text = await req.text();
  if (text.length > MAX_BODY) return Response.json({ code: 'too_large' }, { status: 413 });
  let body: unknown; try { body = JSON.parse(text); } catch { return Response.json({ code: 'invalid' }, { status: 400 }); }

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data, error } = await db.auth.getUser(jwt);                           // verifies the signature with Supabase
  if (error || !data.user) return Response.json({ code: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });

  try {
    const r = await saveSessionCore(sessionDeps(db, data.user.id), data.user.id, body);
    if (r.ok) return Response.json({ ok: true, id: r.id, url: r.url, tabCount: r.tabCount, dropped: r.dropped }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    const status = { invalid: 400, empty: 422, too_large: 413, rate_limited: 429, failed: 500 }[r.error];
    return Response.json({ ok: false, code: r.error }, { status, headers: { 'Cache-Control': 'no-store', ...(r.error === 'rate_limited' ? { 'Retry-After': '600' } : {}) } });
  } catch (e) {
    console.error('session save failed', (e as Error).message);                  // never log the token or the tab list
    return Response.json({ ok: false, code: 'failed' }, { status: 500 });
  }
}
