// Supabase Edge Function (Deno): link-rot scanner. Deploy: supabase functions deploy check-link-health --no-verify-jwt
// Secrets: supabase secrets set CRON_SECRET=<16+ chars>   (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected)
// Scheduled every 10 minutes by link-health/sql/030b_link_health_cron.sql. Each run:
//   1. claims up to BATCH due links (database function, SKIP LOCKED, so overlapping runs never share rows)
//   2. HEAD (then GET to confirm) each URL; redirects are followed by hand and every hop is vetted against private addresses
//   3. for a failing link, asks the Wayback Machine for the latest snapshot
//   4. writes the result back; the database decides when a link counts as dead (see 030_link_health.sql)
import { createClient } from 'npm:@supabase/supabase-js@2';
import { bearerOk } from '../_shared/digest.ts';
import { checkLink, parseWayback, waybackLookupUrl, UA, type Deps, type Dns } from '../_shared/linkhealth.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const BUDGET_MS = 50_000, BATCH = 60, WORKERS = 8, MAX_WAYBACK = 30, PER_HOST = 2;
const reply = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

const deps: Deps = {
  fetch: (url, init) => fetch(url, init),
  async resolve(host): Promise<Dns> {
    const addrs: string[] = []; let nx = false, err = false;
    for (const t of ['A', 'AAAA'] as const) {
      try { addrs.push(...await Deno.resolveDns(host, t)); }
      catch (e) { if (e instanceof Deno.errors.NotFound) nx = true; else err = true; }   // NotFound = no such name / no records of this type
    }
    if (addrs.length) return { addrs };
    return err ? { err: true } : nx ? { nx: true } : { err: true };
  },
};

/** Latest snapshot for a dead link. Any problem returns null: the archive is a bonus, never a reason to fail the run. */
async function wayback(url: string) {
  try {
    const r = await fetch(waybackLookupUrl(url), { signal: AbortSignal.timeout(10_000), headers: { 'user-agent': UA, accept: 'application/json' } });
    if (!r.ok) { void r.body?.cancel(); return null; }
    return parseWayback(await r.json());
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply({ error: 'method' }, 405);
  if (!bearerOk(req.headers.get('authorization'), env('CRON_SECRET'))) return reply({ error: 'unauthorized' }, 401);
  const t0 = Date.now();
  const { data: rows, error } = await db.rpc('link_health_claim', { p_limit: BATCH });
  if (error) { console.error('claim failed', error.message); return reply({ error: 'claim' }, 500); }
  const queue = (rows ?? []) as { id: string; url: string; is_private: boolean }[];
  const sum = { claimed: queue.length, ok: 0, hard: 0, soft: 0, skipped: 0, newly_dead: 0, archived: 0, released: 0 };
  const done = new Set<string>(), inflight = new Map<string, number>();
  let lookups = 0;

  const hostOf = (u: string) => { try { return new URL(u).hostname; } catch { return ''; } };
  async function work() {
    for (;;) {
      if (Date.now() - t0 > BUDGET_MS) return;
      // take the next item whose host isn't already being hit by PER_HOST workers (be a polite crawler)
      const i = queue.findIndex((q) => !done.has(q.id) && (inflight.get(hostOf(q.url)) ?? 0) < PER_HOST && !taken.has(q.id));
      if (i < 0) { if (queue.every((q) => done.has(q.id) || taken.has(q.id))) return; await new Promise((r) => setTimeout(r, 100)); continue; }
      const q = queue[i], host = hostOf(q.url); taken.add(q.id); inflight.set(host, (inflight.get(host) ?? 0) + 1);
      try {
        const res = await checkLink(deps, q.url);
        let arch: { url: string; takenAt: string | null } | null = null;
        if ((res.outcome === 'hard' || res.outcome === 'soft') && !q.is_private && lookups < MAX_WAYBACK) { lookups++; arch = await wayback(q.url); }
        const { data, error: e } = await db.rpc('link_health_apply', { p_id: q.id, p_outcome: res.outcome, p_status: res.status, p_error: res.error, p_archive_url: arch?.url ?? null, p_snapshot_at: arch?.takenAt ?? null });
        if (e) { console.error('apply failed', q.id, e.message); continue; }       // stays claimed; the 10-minute claim timeout frees it
        done.add(q.id); sum[res.outcome === 'ok' ? 'ok' : res.outcome === 'hard' ? 'hard' : res.outcome === 'soft' ? 'soft' : 'skipped']++;
        if (arch) sum.archived++;
        if ((data as { newly_dead?: boolean }[] | null)?.[0]?.newly_dead) sum.newly_dead++;
      } catch (e) { console.error('check crashed', q.id, (e as Error).name); }
      finally { inflight.set(host, Math.max(0, (inflight.get(host) ?? 1) - 1)); }
    }
  }
  const taken = new Set<string>();
  await Promise.all(Array.from({ length: Math.min(WORKERS, queue.length) }, work));

  const left = queue.filter((q) => !done.has(q.id)).map((q) => q.id);               // out of time or crashed: hand the rows back
  if (left.length) { await db.rpc('link_health_release', { p_ids: left }); sum.released = left.length; }
  console.log(JSON.stringify({ ...sum, ms: Date.now() - t0 }));                      // counts only; never log URLs
  return reply(sum);
});
