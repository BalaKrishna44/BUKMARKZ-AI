import { admin } from '@/lib/server';
/**
 * Call (without awaiting the result in the request path) after a bookmark is saved, e.g. in your ingest/save handler.
 * Cheap and idempotent: the SQL returns quickly for users with no referral, for those not yet at 5 links, and for already-rewarded ones.
 */
export async function maybeRewardReferral(userId: string): Promise<void> {
  try { await admin.rpc('reward_referral', { p_referee: userId }); } catch { /* a reward problem must never break saving */ }
}
