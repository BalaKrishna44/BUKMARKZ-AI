// Supabase Edge Function (Deno). Deploy: supabase functions deploy send-friday-digest --no-verify-jwt
// Secrets: supabase secrets set CRON_SECRET=... ALERT_SIGNING_SECRET=... RESEND_API_KEY=... FRIDAY_FROM="Markz & Buk <buk@bukmarkz.com>" SITE_URL=https://bukmarkz.com
//          optional: ANTHROPIC_API_KEY (AI jokes), FRIDAY_MODEL (default claude-haiku-5-5), FRIDAY_AI=0 (force the curated pool), FRIDAY_ASSET_BASE (default $SITE_URL/email)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically. Scheduled by growth-kit/sql/029b_friday_cron.sql:
//   hourly  {"action":"send"}     claims whoever's LOCAL clock just reached Friday 16:00 and mails them
//   Thu 12:00 UTC {"action":"prepare"}  writes this week's joke early so a person can block it (update friday_jokes set status='blocked' where week_key='...')
import { createClient } from 'npm:@supabase/supabase-js@2';
import * as React from 'npm:react@18.3.1';
import { render } from 'npm:@react-email/render@1.0.5';
import FridayJokeDigest, { DEFAULT_CTA } from '../_shared/FridayJokeDigest.tsx';
import { bearerOk } from '../_shared/digest.ts';
import { FRIDAY_REWARD, fridayUnsubscribeUrl, jokePrompt, parseModelJoke, plainText, poolJoke, sha256Hex, shareMailto, subjectFor, weekKey, type JokeSource, type Turn } from '../_shared/friday.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const SITE = (env('SITE_URL') || 'https://bukmarkz.com').replace(/\/$/, '');
const ASSETS = (env('FRIDAY_ASSET_BASE') || `${SITE}/email`).replace(/\/$/, '');
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const BUDGET_MS = 45_000, BATCH = 50;
const reply = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

// ------------------------------------------------------------------ this week's joke: one for everybody, written once
async function aiJoke(week: string): Promise<Turn[] | null> {
  const key = env('ANTHROPIC_API_KEY');
  if (!key || env('FRIDAY_AI') === '0') return null;
  const p = jokePrompt(week, []);
  for (let attempt = 0; attempt < 2; attempt++) {                                  // one retry: models sometimes break the format
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: AbortSignal.timeout(20_000),
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: env('FRIDAY_MODEL') || 'claude-haiku-5-5', max_tokens: 500, temperature: 1, system: p.system, messages: [{ role: 'user', content: p.user }] }),
      });
      if (!res.ok) continue;
      const j = await res.json() as { content?: { type: string; text?: string }[] };
      const t = parseModelJoke(j.content?.find((c) => c.type === 'text')?.text ?? '');
      if (t) return t;                                                             // only a joke that passed validateJoke() is ever stored
    } catch { /* try again, then fall back to the pool */ }
  }
  return null;
}

async function jokeFor(week: string): Promise<{ turns: Turn[]; source: JokeSource }> {
  const got = await db.rpc('friday_get_joke', { p_week: week });
  const row = (got.data as { turns: Turn[]; source: JokeSource; status: string }[] | null)?.[0];
  if (row?.status === 'ready') return { turns: row.turns, source: row.source };
  if (row?.status === 'blocked') return { turns: poolJoke(week), source: 'pool' };   // a person pulled it: curated joke, nothing stored
  const ai = await aiJoke(week);
  const turns = ai ?? poolJoke(week), source: JokeSource = ai ? 'ai' : 'pool';
  const stored = await db.rpc('friday_store_joke', { p_week: week, p_turns: turns, p_source: source });   // a racing worker may have stored one first: its row wins
  const s = (stored.data as { turns: Turn[]; source: JokeSource; status: string }[] | null)?.[0];
  return s && s.status === 'ready' ? { turns: s.turns, source: s.source } : { turns: s ? poolJoke(week) : turns, source: s ? 'pool' : source };
}

// ------------------------------------------------------------------ handler
Deno.serve(async (req) => {
  if (!bearerOk(req.headers.get('authorization'), env('CRON_SECRET'))) return reply({ error: 'unauthorized' }, 401);
  const action = ((await req.json().catch(() => ({}))) as { action?: string }).action ?? 'send';
  const week = weekKey();

  if (action === 'prepare') { const j = await jokeFor(week); return reply({ week, source: j.source, lines: j.turns.length }); }
  if (action !== 'send') return reply({ error: 'bad_action' }, 400);

  const key = env('RESEND_API_KEY'), from = env('FRIDAY_FROM'), sign = env('ALERT_SIGNING_SECRET');
  if (!key || !from || sign.length < 16) return reply({ error: 'not_configured' }, 503);   // never send mail we can't opt out of

  const t0 = Date.now(), rep = { week, source: '', claimed: 0, sent: 0, noEmail: 0, failed: 0 };
  let joke: { turns: Turn[]; source: JokeSource } | null = null;                           // fetched lazily: most hourly runs claim nobody and cost nothing

  for (;;) {
    if (Date.now() - t0 > BUDGET_MS) break;
    const { data: claimed, error } = await db.rpc('claim_friday_users', { p_limit: BATCH });
    if (error) return reply({ ...rep, error: 'claim_failed' }, 500);
    const users = (claimed ?? []) as { user_id: string }[];
    if (!users.length) break;
    rep.claimed += users.length;
    joke ??= await jokeFor(week); rep.source = joke.source;

    const mails: { uid: string; body: Record<string, unknown> }[] = [];
    for (const { user_id: uid } of users) {
      try {
        const { data: au } = await db.auth.admin.getUserById(uid);
        const u = au.user, to = u?.email;
        const banned = u?.banned_until ? new Date(u.banned_until) > new Date() : false;
        if (!to || !u?.email_confirmed_at || banned) { rep.noEmail++; continue; }          // stays claimed: not mailing an unverified or banned address
        const [code, saves] = await Promise.all([db.rpc('friday_referral_code', { p_user: uid }), db.rpc('friday_week_saves', { p_user: uid })]);
        const signupUrl = `${SITE}/signup?ref=${encodeURIComponent(String(code.data ?? ''))}`;
        const unsub = await fridayUnsubscribeUrl(SITE, uid, sign);
        const ctaUrl = `${SITE}/dashboard?intent=flush&utm_source=email&utm_campaign=friday`;
        const props = { turns: joke.turns, ctaUrl, shareHref: shareMailto(joke.turns, code.data ? signupUrl : SITE), rewardCopy: FRIDAY_REWARD, weekSaves: Number(saves.data) || 0, assetBase: ASSETS, unsubscribeUrl: unsub };
        mails.push({ uid, body: {
          from, to: [to], subject: subjectFor(), html: await render(React.createElement(FridayJokeDigest, props)),
          text: plainText({ turns: joke.turns, ctaUrl, ctaLabel: DEFAULT_CTA, signupUrl, unsubscribeUrl: unsub, weekSaves: props.weekSaves }),
          headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }, tags: [{ name: 'campaign', value: 'friday' }],
        } });
      } catch { await db.rpc('friday_release', { p_user: uid }); rep.failed++; }
    }
    if (!mails.length) continue;

    // Resend batch endpoint: up to 100 emails per request, so a big time zone does not hit the per-second rate limit.
    const idem = `friday-${week}-${(await sha256Hex(mails.map((m) => m.uid).sort().join(','))).slice(0, 24)}`;
    try {
      const res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST', signal: AbortSignal.timeout(20_000),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'idempotency-key': idem },
        body: JSON.stringify(mails.map((m) => m.body)),
      });
      if (res.ok) rep.sent += mails.length;
      else { for (const m of mails) await db.rpc('friday_release', { p_user: m.uid }); rep.failed += mails.length; }
    } catch { for (const m of mails) await db.rpc('friday_release', { p_user: m.uid }); rep.failed += mails.length; }
  }
  return reply(rep);
});
