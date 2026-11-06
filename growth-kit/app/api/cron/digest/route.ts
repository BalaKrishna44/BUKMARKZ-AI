import { admin, isCron, json } from '@/lib/server';          // same helpers as price-alerts
import { runDigest } from '@/lib/digest/run';
import { signingConfigured } from '@/lib/digest/build';

/** Weekly (Vercel Cron, e.g. "0 4 * * 1"). Bearer CRON_SECRET only. Opt-in users only; safe to fire twice (claims are atomic). */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://bukmarkz.com').replace(/\/$/, '');

export async function GET(req: Request) {
  if (!isCron(req)) return json({ error: 'unauthorized' }, 401);
  const key = process.env.RESEND_API_KEY, from = process.env.DIGEST_FROM ?? process.env.ALERTS_FROM;
  if (!key || !from || !signingConfigured()) return json({ error: 'not_configured' }, 503);
  const report = await runDigest({
    site: SITE,
    claim: async (n) => { const { data, error } = await admin.rpc('claim_digest_users', { p_limit: n }); if (error) throw error; return data ?? []; },
    pick: async (uid, ex) => { const { data, error } = await admin.rpc('digest_pick_items', { p_user: uid, p_exclude: ex, p_limit: 5 }); if (error) throw error; return data ?? []; },
    emailOf: async (uid) => (await admin.auth.admin.getUserById(uid)).data.user?.email ?? null,
    send: async (m) => {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(6000),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'idempotency-key': m.key },
        body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text, html: m.html, headers: { 'List-Unsubscribe': `<${m.unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }),
      });
      return res.ok;
    },
    record: async (uid, ids) => { await admin.rpc('digest_record', { p_user: uid, p_ids: ids }); },
    release: async (uid) => { await admin.rpc('digest_release', { p_user: uid }); },
  });
  return json(report);
}
