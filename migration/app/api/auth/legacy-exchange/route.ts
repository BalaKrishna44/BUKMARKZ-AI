import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { exchangeLegacyToken, memoryLimiter } from '@/lib/legacy/exchange';
import { extractLegacyToken, verifyLegacyToken } from '@/lib/legacy/verify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const limiter = memoryLimiter(20, 60_000);

/** POST with `Authorization: Token <knox token>` → { access_token, refresh_token, expires_in }. */
export async function POST(req: NextRequest) {
  const token = extractLegacyToken(req.headers.get('authorization'));
  if (!token) return Response.json({ code: 'invalid_token' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!, opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, opts);
  const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, opts);
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';

  const r = await exchangeLegacyToken({
    verify: verifyLegacyToken,
    admin: { getUserById: (id) => admin.auth.admin.getUserById(id) as any, generateLink: (a) => admin.auth.admin.generateLink(a) as any },
    verifyOtp: (a) => anon.auth.verifyOtp(a) as any,
    sunset: process.env.LEGACY_TOKEN_SUNSET, limiter,
    audit: (event, f) => console.info(JSON.stringify({ event, ...f })),   // never includes the token
  }, token, ip);

  const h = { 'Cache-Control': 'no-store' };
  if (!r.ok) return Response.json({ code: r.code }, { status: r.status, headers: h });
  const { access_token, refresh_token, expires_in, expires_at } = r.session;
  return Response.json({ access_token, refresh_token, expires_in, expires_at }, { headers: h });
}
