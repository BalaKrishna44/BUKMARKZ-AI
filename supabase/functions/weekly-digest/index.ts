// Supabase Edge Function (Deno). Deploy: supabase functions deploy weekly-digest --no-verify-jwt
// Secrets:  supabase secrets set CRON_SECRET=... ALERT_SIGNING_SECRET=... RESEND_API_KEY=... DIGEST_FROM="Buk <buk@bukmarkz.com>" SITE_URL=https://bukmarkz.com
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.) Triggered by pg_cron: growth-kit/sql/025b_digest_cron.sql
import { createClient } from 'npm:@supabase/supabase-js@2';
import * as React from 'npm:react@18.3.1';
import { render } from 'npm:@react-email/render@1.0.5';
import WeeklyDigestEmail, { pickPrompt } from '../_shared/WeeklyDigestEmail.tsx';
import { MIN_ITEMS, bearerOk, isoWeek, plainText, toRows, unsubscribeUrl, type PickedItem } from '../_shared/digest.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const SITE = (env('SITE_URL') || 'https://bukmarkz.com').replace(/\/$/, '');
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const BUDGET_MS = 50_000;
const reply = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (!bearerOk(req.headers.get('authorization'), env('CRON_SECRET'))) return reply({ error: 'unauthorized' }, 401);
  const key = env('RESEND_API_KEY'), from = env('DIGEST_FROM'), sign = env('ALERT_SIGNING_SECRET');
  if (!key || !from || sign.length < 16) return reply({ error: 'not_configured' }, 503);   // never send mail we can't opt out of

  const t0 = Date.now(), rep = { claimed: 0, sent: 0, skippedFewLinks: 0, noEmail: 0, failed: 0 };
  const { data: users, error } = await db.rpc('claim_digest_users', { p_limit: 200 });     // atomic: a second firing claims nothing
  if (error) return reply({ error: 'claim_failed' }, 500);
  rep.claimed = users?.length ?? 0;

  for (const [n, u] of (users ?? []).entries() as Iterable<[number, { user_id: string; last_item_ids: string[] }]>) {
    if (Date.now() - t0 > BUDGET_MS) {                                                      // out of time: hand the rest back for the next run
      for (const r of users!.slice(n)) await db.rpc('digest_release', { p_user: r.user_id });
      rep.failed += users!.length - n; break;
    }
    try {
      const { data: au } = await db.auth.admin.getUserById(u.user_id);
      const to = au.user?.email;
      if (!to) { rep.noEmail++; continue; }

      const { data: items, error: pe } = await db.rpc('digest_pick_items', { p_user: u.user_id, p_exclude: u.last_item_ids ?? [], p_limit: 5 });
      if (pe) throw pe;
      if (!items || items.length < MIN_ITEMS) { rep.skippedFewLinks++; continue; }          // never send a thin email (stays claimed; next eligible week retries)

      const rows = toRows(items as PickedItem[], SITE);
      const quizUrl = `${SITE}/dashboard?resurface=1`;
      const unsub = await unsubscribeUrl(SITE, u.user_id, sign);
      const props = { rows, quizUrl, unsubscribeUrl: unsub, prompt: pickPrompt(isoWeek()) };
      const html = await render(React.createElement(WeeklyDigestEmail, props));
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(6000),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'idempotency-key': `digest-${u.user_id}-${new Date().toISOString().slice(0, 10)}` },
        body: JSON.stringify({ from, to: [to], subject: `Buk found ${rows.length} links you forgot`, html, text: plainText(rows, quizUrl, unsub),
          headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }),
      });
      if (res.ok) { await db.rpc('digest_record', { p_user: u.user_id, p_ids: rows.map((r) => r.id) }); rep.sent++; }
      else { await db.rpc('digest_release', { p_user: u.user_id }); rep.failed++; }
    } catch { await db.rpc('digest_release', { p_user: u.user_id }); rep.failed++; }
  }
  return reply(rep);
});
