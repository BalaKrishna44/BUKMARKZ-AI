import { admin } from '@/lib/server';
import { verifyWatchToken } from '@/lib/alerts/token';

/**
 * Stop alerts for one watch from the email link. POST is the RFC 8058 one-click endpoint (mail clients call it). GET only shows a confirm
 * button, because mail scanners prefetch links and a GET that changed anything would unsubscribe people by accident.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const page = (body: string, status = 200) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bukmarkz price alerts</title><body style="font-family:system-ui,sans-serif;max-width:420px;margin:15vh auto;padding:0 16px;line-height:1.5">${body}</body>`, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
const params = (req: Request) => { const u = new URL(req.url); return { w: u.searchParams.get('w') ?? '', t: u.searchParams.get('t') ?? '' }; };
const valid = (w: string, t: string) => UUID.test(w) && verifyWatchToken(w, t);

export async function GET(req: Request) {
  const { w, t } = params(req);
  if (!valid(w, t)) return page('<h2>This link is not valid</h2><p>It may be incomplete. You can manage alerts in Bukmarkz.</p>', 400);
  return page(`<h2>Stop price alerts for this product?</h2><form method="post" action="/api/prices/unsubscribe?w=${w}&t=${t}"><button style="padding:10px 16px;font-size:16px">Stop alerts</button></form>`);
}
export async function POST(req: Request) {
  const { w, t } = params(req);
  if (!valid(w, t)) return page('<h2>This link is not valid</h2>', 400);
  const { error } = await admin.rpc('price_deactivate_watch', { p_watch: w });
  if (error) return page('<h2>Something went wrong</h2><p>Please try again.</p>', 500);
  return page('<h2>Done</h2><p>You will not get more alerts for this product.</p>');
}
