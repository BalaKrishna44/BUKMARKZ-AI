import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/** Service-role client: bypasses RLS. Only call after authenticating the user, and always filter by user_id. */
export const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Bearer token (mobile / extension) first, then the Supabase session cookie (web app). */
export async function requireUser(req: Request) {
  const h = req.headers.get('authorization') ?? '';
  if (h.startsWith('Bearer ')) {
    const { data, error } = await admin.auth.getUser(h.slice(7).trim());
    return error ? null : data.user;
  }
  const jar = await cookies();
  const sb = createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => jar.getAll(), setAll: () => {} },
  });
  const { data } = await sb.auth.getUser();
  return data.user ?? null;
}

/** Cron endpoints: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. */
export function isCron(req: Request) {
  const s = process.env.CRON_SECRET;
  return !!s && req.headers.get('authorization') === `Bearer ${s}`;
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5';
