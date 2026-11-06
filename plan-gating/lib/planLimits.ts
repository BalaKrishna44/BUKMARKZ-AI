/**
 * Plan caps and the one function every feature calls before doing billable work.
 *
 *   const g = await checkFeatureLimit(user.id, 'ask');          // throws LimitExceededError when over the cap
 *   try { ...do the work... } catch (e) { await refundFeature(user.id, 'ask'); throw e; }
 *
 * PLAN_LIMITS is the ONLY place caps live. It is sent to Postgres on every call (gate_consume), so SQL never carries its own copy,
 * and the pricing page, the MCP server and the upgrade prompts all read the same table. `null` means unlimited (still counted).
 * Server-only: it uses the service-role client. Import `lib/upgrade.ts` from client components instead.
 */
import { upgradeUrlFor, resetsAtISO, type Feature, type PlanId } from './upgrade';

export type { Feature, PlanId } from './upgrade';
export type FeatureKey = 'ask' | 'mcp' | 'index';           // the three features this module's public API gates (snapshots use the same engine, see gateConsume)

export const PLAN_LIMITS: Record<PlanId, Record<Feature, number | null>> = {
  //            Ask per month | MCP calls per month | AI-indexed items (total, not per month) | page snapshots per month
  free: { ask: 20,   mcp: 50,     index: 300,    snapshot: 0 },
  pro:  { ask: 1000, mcp: 10_000, index: 25_000, snapshot: 500 },
  team: { ask: 1500, mcp: 10_000, index: 25_000, snapshot: 1000 },     // per seat; team caps were not specified, so these are my placeholders: change freely
};

/** Minimal database surface (the Supabase service-role client satisfies it), so everything here is testable without a server. */
export interface RpcDb { rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: { message: string } | null }> }

async function defaultDb(): Promise<RpcDb> { return (await import('@/lib/server')).admin as unknown as RpcDb; }

export type LimitReason = 'monthly' | 'total' | 'plan' | 'not_configured';

/** Structured, serialisable. Route handlers turn it into HTTP 402 (lib/http/limit.ts) and the MCP server into a tool error (lib/mcp/errors.ts). */
export class LimitExceededError extends Error {
  readonly code = 'limit_exceeded' as const;
  readonly status = 402;
  readonly upgradeUrl: string;
  readonly resetsAt: string | null;
  constructor(readonly feature: Feature, readonly plan: PlanId, readonly used: number, readonly limit: number, readonly reason: LimitReason, now = new Date()) {
    super(limitSentence(feature, plan, used, limit, reason));
    this.name = 'LimitExceededError';
    this.upgradeUrl = upgradeUrlFor(feature, plan);
    this.resetsAt = reason === 'monthly' ? resetsAtISO(now) : null;
  }
  toJSON() {
    return { error: this.code, message: this.message, feature: this.feature, plan: this.plan, used: this.used, limit: this.limit, reason: this.reason, upgradeUrl: this.upgradeUrl, resetsAt: this.resetsAt };
  }
}

/** The gate could not be evaluated (database down, bad config). Callers must NOT run the billable work: we fail closed. */
export class GateUnavailableError extends Error {
  readonly code = 'gate_unavailable' as const;
  readonly status = 503;
  constructor(detail?: string) { super('Usage checks are temporarily unavailable. Please try again in a moment.'); this.name = 'GateUnavailableError'; if (detail) console.error('gate unavailable:', detail.slice(0, 200)); }
}

const NOUN: Record<Feature, [string, string]> = { ask: ['Ask', 'Asks'], mcp: ['MCP call', 'MCP calls'], index: ['AI-indexed bookmark', 'AI-indexed bookmarks'], snapshot: ['page snapshot', 'page snapshots'] };
const PLAN_NAME: Record<PlanId, string> = { free: 'Free', pro: 'Pro', team: 'Team' };

export function limitSentence(feature: Feature, plan: PlanId, used: number, limit: number, reason: LimitReason): string {
  const n = NOUN[feature][1];
  if (reason === 'plan' || limit === 0) return `${n[0].toUpperCase()}${n.slice(1)} are not included in the ${PLAN_NAME[plan]} plan.`;
  if (reason === 'total') return `${PLAN_NAME[plan]} plan limit reached: ${used.toLocaleString('en-US')}/${limit.toLocaleString('en-US')} ${n} in your vault.`;
  return `${PLAN_NAME[plan]} plan limit reached: ${used.toLocaleString('en-US')}/${limit.toLocaleString('en-US')} ${n} this month.`;
}

export interface Granted { plan: PlanId; feature: Feature; used: number; limit: number | null; granted: number; partial: boolean }
export interface GateOptions {
  /** How many units this action costs. Default 1. For `index`, the number of bookmarks about to be embedded. */
  amount?: number;
  /** `index` only: grant as many as still fit instead of all-or-nothing. The result tells you how many (granted). */
  partial?: boolean;
  db?: RpcDb;
  now?: Date;
}

const asPlan = (v: unknown): PlanId => (v === 'pro' || v === 'team' ? v : 'free');

/**
 * Atomically check AND increment. Throws LimitExceededError when the cap is reached (nothing is counted), GateUnavailableError when we
 * cannot tell. Parallel callers cannot overshoot: the check and the increment are a single SQL statement (see 016_plan_gating.sql).
 */
export async function checkFeatureLimit(userId: string, feature: Feature, opts: GateOptions = {}): Promise<Granted> {
  if (!userId) throw new GateUnavailableError('missing user id');
  const amount = opts.amount ?? 1;
  if (!Number.isInteger(amount) || amount < 1) throw new GateUnavailableError('invalid amount');
  const db = opts.db ?? (await defaultDb());
  let res;
  try { res = await db.rpc('gate_consume', { p_user: userId, p_feature: feature, p_amount: amount, p_limits: PLAN_LIMITS, p_partial: !!opts.partial }); }
  catch (e) { throw new GateUnavailableError((e as Error).message); }
  const { data, error } = res;
  if (error || !data || typeof data !== 'object') throw new GateUnavailableError(error?.message);
  const plan = asPlan(data.plan);
  if (!data.allowed) {
    const lim = data.limit == null ? 0 : Number(data.limit) || 0;
    const reason: LimitReason = ['monthly', 'total', 'plan', 'not_configured'].includes(data.reason) ? data.reason : 'monthly';
    if (reason === 'not_configured') throw new GateUnavailableError(`no limit configured for ${plan}/${feature}`);
    throw new LimitExceededError(feature, plan, Number(data.used) || 0, lim, reason, opts.now);
  }
  const granted = Number(data.granted) || amount;
  return { plan, feature, used: Number(data.used) || 0, limit: data.limit == null ? null : Number(data.limit), granted, partial: !!data.partial };
}

/** Give units back when WE failed after the check passed (not when the user's input was bad). Best effort, never throws. */
export async function refundFeature(userId: string, feature: Feature, amount = 1, db?: RpcDb): Promise<void> {
  try { await (db ?? await defaultDb()).rpc('gate_refund', { p_user: userId, p_feature: feature, p_amount: amount }); } catch { /* a missed refund favours the user next month; do not mask the original error */ }
}

/** Call after deleting indexed bookmarks so the capacity comes back. */
export async function releaseIndexed(userId: string, count: number, db?: RpcDb): Promise<void> {
  try { await (db ?? await defaultDb()).rpc('gate_release_index', { p_user: userId, p_count: count }); } catch { /* reconcile job fixes drift */ }
}

/** Nightly job: set the stock counter from the real number of indexed rows so drift can never lock a user out. */
export async function reconcileIndexed(userId: string, realCount: number, db?: RpcDb): Promise<void> {
  await (db ?? await defaultDb()).rpc('gate_set_indexed_total', { p_user: userId, p_total: realCount });
}

export interface UsageSnapshot { plan: PlanId; month: string; features: Record<Feature, { used: number; limit: number | null }> }
/** Everything the settings page needs, read-only. */
export async function getUsage(userId: string, db?: RpcDb): Promise<UsageSnapshot> {
  const { data, error } = await (db ?? await defaultDb()).rpc('gate_usage', { p_user: userId, p_limits: PLAN_LIMITS });
  if (error || !data) throw new GateUnavailableError(error?.message);
  return { plan: asPlan(data.plan), month: String(data.month), features: data.features };
}
