import { admin } from '@/lib/server';
import { verifyUserToken } from '@/lib/digest/build';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const page = (body: string, status = 200) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><title>Weekly digest</title><body style="font-family:system-ui;max-width:420px;margin:12vh auto;padding:0 16px">${body}`, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });

/** GET only SHOWS a confirm button: mail scanners prefetch links, and a prefetch must not unsubscribe anyone by accident. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams, u = q.get('u') ?? '', t = q.get('t') ?? '';
  if (!UUID.test(u) || !verifyUserToken(u, t)) return page('<h1>Link not valid</h1><p>Open Settings in Bukmarkz to change email preferences.</p>', 400);
  return page(`<h1>Stop the weekly digest?</h1><form method="post" action="/api/digest/unsubscribe?u=${encodeURIComponent(u)}&t=${encodeURIComponent(t)}"><button style="padding:10px 16px">Yes, stop it</button></form>`);
}
/** POST is both the button above and the mail client's one-click List-Unsubscribe-Post. */
export async function POST(req: Request) {
  const q = new URL(req.url).searchParams, u = q.get('u') ?? '', t = q.get('t') ?? '';
  if (!UUID.test(u) || !verifyUserToken(u, t)) return page('<h1>Link not valid</h1>', 400);
  const { error } = await admin.from('digest_prefs').upsert({ user_id: u, enabled: false, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  return error ? page('<h1>Something went wrong</h1><p>Please try again.</p>', 500) : page('<h1>Done</h1><p>You will not get the weekly digest any more.</p>');
}
