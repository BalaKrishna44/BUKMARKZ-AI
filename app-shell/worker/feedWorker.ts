/**
 * Feed ingestion worker.
 *   long-running:   node --import tsx worker/feedWorker.ts          (loops every 30 s)
 *   serverless:     GET /api/cron/feeds calls runOnce() every few minutes
 * Any number of instances can run at once: claim_due_feeds uses FOR UPDATE SKIP LOCKED + a lease.
 */
import { admin } from '../lib/server';
import { fetchFeed } from '../lib/feeds/fetchFeed';

const CONCURRENCY = 4;
const BROKEN_AFTER = 10;
const jitter = (min: number) => min * 60_000 * (0.9 + Math.random() * 0.2);

async function processFeed(f: any) {
  const r = await fetchFeed(f);
  const now = new Date();

  if (r.kind === 'error') {
    const failures = f.consecutive_failures + 1;
    const backoffMs = r.retryAfterSec ? r.retryAfterSec * 1000 : Math.min(f.fetch_interval_min * 60_000 * 2 ** failures, 24 * 3600_000);
    await admin.from('feeds').update({
      consecutive_failures: failures, last_error: r.error, last_fetched_at: now.toISOString(), leased_until: null,
      next_fetch_at: new Date(+now + backoffMs).toISOString(), status: failures >= BROKEN_AFTER ? 'broken' : 'active',
    }).eq('id', f.id);
    return { id: f.id, ok: false };
  }

  let inserted = 0;
  if (r.kind === 'ok' && r.entries.length) {
    const rows = r.entries.map((e) => ({ ...e, feed_id: f.id, user_id: f.user_id }));
    // ignoreDuplicates => existing entries (same feed + guid) are left alone, so read/saved state is never reset.
    const { data, error } = await admin.from('feed_entries').upsert(rows, { onConflict: 'feed_id,guid', ignoreDuplicates: true }).select('id');
    if (error) throw error;
    inserted = data?.length ?? 0;
  }
  await admin.from('feeds').update({
    consecutive_failures: 0, last_error: null, last_fetched_at: now.toISOString(), leased_until: null,
    next_fetch_at: new Date(+now + jitter(f.fetch_interval_min)).toISOString(),
    ...(r.kind === 'ok' ? { title: f.title ?? r.title, site_url: r.siteUrl, etag: r.etag, last_modified: r.lastModified } : {}),
  }).eq('id', f.id);
  return { id: f.id, ok: true, inserted };
}

export async function runOnce(limit = 20) {
  const { data: feeds, error } = await admin.rpc('claim_due_feeds', { p_limit: limit, p_lease_sec: 300 });
  if (error) throw error;
  const queue = [...(feeds ?? [])];
  const out: any[] = [];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (let f = queue.pop(); f; f = queue.pop()) {
      try { out.push(await processFeed(f)); }
      catch (e: any) { out.push({ id: f.id, ok: false, error: String(e?.message ?? e) }); }
    }
  }));
  // Housekeeping: drop old, unsaved entries (keeps the table bounded).
  await admin.from('feed_entries').delete().lt('published_at', new Date(Date.now() - 90 * 864e5).toISOString()).is('saved_item_id', null);
  return out;
}

if (process.argv[1]?.endsWith('feedWorker.ts') || process.argv[1]?.endsWith('feedWorker.js')) {
  (async () => { for (;;) { try { const r = await runOnce(); if (r.length) console.log(new Date().toISOString(), JSON.stringify(r)); } catch (e) { console.error(e); } await new Promise((r) => setTimeout(r, 30_000)); } })();
}
