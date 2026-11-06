import type { SupabaseClient } from '@supabase/supabase-js';
import { enrichItems, type UsageSink } from './enrich';
import { assertBudget, recordUsage, BudgetExceededError, FALLBACK_MODEL } from '@/lib/ai/circuitBreaker';

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

    // AI cost control. Find whose items these are (cron batches mix users), stop spending for anyone over their allowance, and use the
    // cheap model when the batch contains someone who is over 100%. Items we skip go back to the queue untouched.
    const { data: owners } = await admin.from('oneclist_items').select('id,user_id').in('id', claimed.map((c: any) => c.id));
    const ownerOf = new Map<string, string>((owners ?? []).map((o: any) => [o.id, o.user_id]));
    const verdict = new Map<string, { degraded: boolean } | 'blocked'>();
    for (const uid of new Set(ownerOf.values())) {
      try { verdict.set(uid, await assertBudget(uid, admin as any)); }
      catch (e) { if (e instanceof BudgetExceededError) verdict.set(uid, 'blocked'); else throw e; }
    }
    const skipped = claimed.filter((c: any) => !ownerOf.has(c.id) || verdict.get(ownerOf.get(c.id)!) === 'blocked');
    if (skipped.length) { await admin.rpc('release_ai_items', { p_ids: skipped.map((c: any) => c.id) }); lastError = 'ai_budget_exceeded'; }
    const run = claimed.filter((c: any) => !skipped.includes(c));
    if (!run.length) break;                                   // nothing affordable in this round: stop instead of spinning on blocked users
    const degraded = run.some((c: any) => (verdict.get(ownerOf.get(c.id)!) as { degraded: boolean }).degraded);
    const usage: Parameters<UsageSink>[0][] = [];

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.max(5_000, deadline - Date.now()));
    try {
      const { ready, failed } = await enrichItems(run, ctrl.signal, (u) => usage.push(u), degraded ? FALLBACK_MODEL() : undefined);
      await chargeUsers(admin, usage, run.map((c: any) => ownerOf.get(c.id)!), degraded);
      if (ready.length) {
        const { error: e1 } = await admin.rpc('apply_ai_results', { p_results: ready });
        if (e1) { lastError = e1.message; failed.push(...ready.map((r) => r.id)); } else processed += ready.length;
      }
      if (failed.length) { failedCount += failed.length; await admin.rpc('release_ai_items', { p_ids: failed }); }
    } catch (e) {
      await admin.rpc('release_ai_items', { p_ids: run.map((c: any) => c.id) });
      lastError = String((e as Error).message ?? e); break;
    } finally { clearTimeout(timer); }
  }
  return { processed, failedCount, lastError };
}

/** Split this round's token usage across the users whose items were in it (proportional to item count) and write each share to the ledger. */
async function chargeUsers(admin: SupabaseClient, usage: { model: string; inputTokens: number; outputTokens: number }[], owners: string[], degraded: boolean) {
  const counts = new Map<string, number>();
  for (const o of owners) counts.set(o, (counts.get(o) ?? 0) + 1);
  for (const u of usage) for (const [uid, n] of counts) {
    const share = n / owners.length;
    await recordUsage({ userId: uid, feature: 'enrich', model: u.model, inputTokens: u.inputTokens * share, outputTokens: u.outputTokens * share, degraded, db: admin as any });
  }
}
