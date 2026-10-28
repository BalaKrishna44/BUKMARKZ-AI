import type { SupabaseClient } from '@supabase/supabase-js';
import { enrichItems } from './enrich';

/**
 * One invocation of the queue worker. Safe to run concurrently (rows are claimed with SKIP LOCKED).
 * Stops when the time budget is spent so it fits inside a serverless function's maxDuration.
 */
export async function runEnrichment(admin: SupabaseClient, opts: { userId?: string; jobId?: string; budgetMs?: number; batchSize?: number }) {
  const deadline = Date.now() + (opts.budgetMs ?? 40_000);
  const batchSize = opts.batchSize ?? 30;
  let processed = 0, failedCount = 0, rounds = 0, lastError: string | null = null;

  while (Date.now() < deadline - 8_000 && rounds++ < 100) { // leave ~8s for one more LLM round trip
    const { data: claimed, error } = await admin.rpc('claim_ai_batch', { p_user: opts.userId ?? null, p_job: opts.jobId ?? null, p_limit: batchSize });
    if (error) { lastError = error.message; break; }
    if (!claimed?.length) break;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.max(5_000, deadline - Date.now()));
    try {
      const { ready, failed } = await enrichItems(claimed, ctrl.signal);
      if (ready.length) {
        const { error: e1 } = await admin.rpc('apply_ai_results', { p_results: ready });
        if (e1) { lastError = e1.message; failed.push(...ready.map((r) => r.id)); } else processed += ready.length;
      }
      if (failed.length) { failedCount += failed.length; await admin.rpc('release_ai_items', { p_ids: failed }); }
    } catch (e) {
      await admin.rpc('release_ai_items', { p_ids: claimed.map((c: any) => c.id) });
      lastError = String((e as Error).message ?? e); break;
    } finally { clearTimeout(timer); }
  }
  return { processed, failedCount, lastError };
}
