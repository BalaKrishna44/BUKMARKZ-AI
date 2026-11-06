/**
 * AI cost ledger + per-user circuit breaker.
 *
 *   const r = await guardedLLM({ userId, feature: 'ask', cacheKey, call: async ({ model, maxOutputTokens }) => {
 *     const out = await anthropic.messages.create({ model, max_tokens: maxOutputTokens, ... });
 *     return { text, model, inputTokens: out.usage.input_tokens, outputTokens: out.usage.output_tokens };
 *   }});
 *
 * Every request is written to ai_usage_ledger with its token counts and cost. A user's spend this (UTC) month is compared with 25% of what
 * their plan is worth to us per month:
 *     under 80%   ok        normal model
 *     80-100%     warn      normal model, `state: 'warn'` so the UI can say so
 *     100-200%    degraded  forced onto the cheap model (Haiku), smaller output cap, smaller context allowance
 *     over 200%   blocked   cached answer if there is one, otherwise BudgetExceededError (HTTP 402 with an upgrade link)
 * If the budget cannot be read the request is treated as `degraded`, not `ok`: a database blip must never mean unlimited Sonnet.
 * Optional global kill switch: AI_GLOBAL_MONTHLY_CAP_USD; at the cap every request is `blocked` unless cached.
 */
import { costUsd } from './pricing';
import { resetsAtISO, upgradeUrlFor, type PlanId } from '../upgrade';
import type { RpcDb } from '../planLimits';

export const BUDGET_SHARE = 0.25;
export const LIST_PRICE_USD: Record<PlanId, number> = { free: 0, pro: 2, team: 12.99 };  // per month, per seat. KEEP IN SYNC with pricing/currency.ts (USD). A real per-user price from the DB overrides this.
export const FREE_BUDGET_USD = () => num(process.env.AI_FREE_BUDGET_USD, 0.2);            // free has no price, so a fixed allowance
export const PRIMARY_MODEL = () => process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5';
export const FALLBACK_MODEL = () => process.env.AI_FALLBACK_MODEL ?? 'claude-haiku-5-5';
export const DEGRADED_MAX_OUTPUT = 400;
export const DEGRADED_CONTEXT_CHARS = 6000;

function num(v: string | undefined, d: number): number { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? n : d; }
async function defaultDb(): Promise<RpcDb> { return (await import('@/lib/server')).admin as unknown as RpcDb; }

export type BudgetLevel = 'ok' | 'warn' | 'degraded' | 'blocked';
export interface Budget { plan: PlanId; budgetUsd: number; spentUsd: number; ratio: number; level: BudgetLevel }

/** Monthly dollars we are willing to spend on this user's LLM calls. A real per-user price (annual/12, team seat) beats the list price. */
export function budgetFor(plan: PlanId, monthlyPriceUsd?: number | null): number {
  if (plan === 'free') return FREE_BUDGET_USD();
  const price = monthlyPriceUsd != null && Number.isFinite(monthlyPriceUsd) && monthlyPriceUsd > 0 ? monthlyPriceUsd : LIST_PRICE_USD[plan];
  return Math.round(price * BUDGET_SHARE * 1e6) / 1e6;
}

export function levelFor(ratio: number): BudgetLevel { return ratio >= 2 ? 'blocked' : ratio >= 1 ? 'degraded' : ratio >= 0.8 ? 'warn' : 'ok'; }

export function evaluate(plan: PlanId, spentUsd: number, monthlyPriceUsd?: number | null): Budget {
  const budgetUsd = budgetFor(plan, monthlyPriceUsd);
  const spent = Math.max(0, Number(spentUsd) || 0);
  const ratio = budgetUsd > 0 ? spent / budgetUsd : Infinity;
  return { plan, budgetUsd, spentUsd: spent, ratio, level: levelFor(ratio) };
}

export async function getBudget(userId: string, db?: RpcDb): Promise<Budget | null> {
  try {
    const { data, error } = await (db ?? await defaultDb()).rpc('ai_budget_state', { p_user: userId });
    if (error || !data) return null;
    const plan: PlanId = data.plan === 'pro' || data.plan === 'team' ? data.plan : 'free';
    return evaluate(plan, Number(data.spent_usd), data.monthly_price_usd == null ? null : Number(data.monthly_price_usd));
  } catch { return null; }
}

export class BudgetExceededError extends Error {
  readonly code = 'ai_budget_exceeded' as const;
  readonly status = 402;
  readonly upgradeUrl: string;
  readonly resetsAt: string;
  constructor(readonly plan: PlanId, now = new Date()) {
    super(plan === 'free'
      ? 'You have used this month\'s AI allowance on the Free plan. Upgrade to Pro for much more, or it resets next month.'
      : 'You have used this month\'s fair-use AI allowance. It resets next month; contact us if you need more.');
    this.name = 'BudgetExceededError';
    this.upgradeUrl = upgradeUrlFor('ask', plan);
    this.resetsAt = resetsAtISO(now);
  }
  toJSON() { return { error: this.code, message: this.message, plan: this.plan, upgradeUrl: this.upgradeUrl, resetsAt: this.resetsAt }; }
}

export interface LLMResult { text: string; model: string; inputTokens: number; outputTokens: number }
export interface CallContext {
  model: string;
  maxOutputTokens: number;
  /** Characters of retrieved context you may send. Smaller when degraded. Truncate your prompt context to this. */
  contextChars: number;
  degraded: boolean;
}
export interface GuardOptions {
  userId: string;
  feature: string;                                  // /^[a-z0-9_.-]{1,60}$/
  call: (ctx: CallContext) => Promise<LLMResult>;
  preferredModel?: string;
  maxOutputTokens?: number;
  contextChars?: number;
  /** Same question, same answer: a stable key (see cacheKeyFor). Enables cache-first and the blocked-state fallback. */
  cacheKey?: string;
  cacheTtlSeconds?: number;
  db?: RpcDb;
  now?: Date;
}
export interface GuardedResult { text: string; model: string; source: 'llm' | 'cache'; level: BudgetLevel | 'unknown'; degraded: boolean; costUsd: number }

/** Stable cache key from the inputs that determine the answer. Include the question, a version of the retrieved context, and the feature. */
export async function cacheKeyFor(feature: string, ...parts: string[]): Promise<string> {
  const data = new TextEncoder().encode([feature, ...parts.map((p) => p.trim().replace(/\s+/g, ' ').toLowerCase())].join('\u0000'));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Write one request to the ledger. Never throws: losing a ledger row must not fail the user's answer (it is logged loudly instead). */
export async function recordUsage(o: { userId: string; feature: string; model: string; inputTokens: number; outputTokens: number; degraded?: boolean; reason?: string; db?: RpcDb }): Promise<number> {
  const cost = costUsd(o.model, o.inputTokens, o.outputTokens);
  try {
    const { error } = await (o.db ?? await defaultDb()).rpc('ai_ledger_record', {
      p_user: o.userId, p_feature: o.feature, p_model: o.model, p_in: Math.max(0, Math.floor(o.inputTokens) || 0), p_out: Math.max(0, Math.floor(o.outputTokens) || 0),
      p_cost: cost, p_degraded: !!o.degraded, p_reason: o.reason ?? null,
    });
    if (error) console.error('ai ledger write failed', o.feature, error.message);
  } catch (e) { console.error('ai ledger write failed', o.feature, (e as Error).message); }
  return cost;
}

async function globalCapReached(db: RpcDb): Promise<boolean> {
  const cap = num(process.env.AI_GLOBAL_MONTHLY_CAP_USD, 0);
  if (!cap) return false;
  try { const { data, error } = await db.rpc('ai_global_spend'); return !error && Number(data) >= cap; } catch { return false; }
}

async function cacheGet(db: RpcDb, userId: string, key: string): Promise<string | null> {
  try { const { data, error } = await db.rpc('ai_cache_get', { p_user: userId, p_key: key }); return !error && typeof data === 'string' ? data : null; } catch { return null; }
}
async function cacheSet(db: RpcDb, userId: string, key: string, value: string, ttl: number, model: string): Promise<void> {
  try { await db.rpc('ai_cache_set', { p_user: userId, p_key: key, p_value: value, p_ttl_seconds: ttl, p_model: model }); } catch { /* cache is an optimisation */ }
}

/**
 * Pre-flight for LLM calls that cannot use guardedLLM (batch workers, vision, podcast scripts). Throws BudgetExceededError when the user
 * must not spend more: Free stops at 100% of its allowance, paid plans at 200% (the blocked level), and the global kill switch stops all.
 * Returns {degraded:true} when the caller should use the cheap model. If the budget cannot be read it degrades instead of allowing full spend.
 */
export async function assertBudget(userId: string, db?: RpcDb): Promise<{ degraded: boolean; level: BudgetLevel | 'unknown'; plan: PlanId | null }> {
  const d = db ?? await defaultDb();
  const b = await getBudget(userId, d);
  if (await globalCapReached(d)) throw new BudgetExceededError(b?.plan ?? 'free');
  if (!b) return { degraded: true, level: 'unknown', plan: null };
  if (b.level === 'blocked' || (b.plan === 'free' && b.level === 'degraded')) throw new BudgetExceededError(b.plan);
  return { degraded: b.level === 'degraded', level: b.level, plan: b.plan };
}

/** Run an LLM call under the breaker. See the header comment for the state machine. */
export async function guardedLLM(o: GuardOptions): Promise<GuardedResult> {
  const db = o.db ?? await defaultDb();
  const ttl = o.cacheTtlSeconds ?? 86_400;

  // 1. Cache first: free for us, instant for them, and the only thing a blocked user can still get.
  if (o.cacheKey) {
    const hit = await cacheGet(db, o.userId, o.cacheKey);
    if (hit !== null) return { text: hit, model: 'cache', source: 'cache', level: 'ok', degraded: false, costUsd: 0 };
  }

  // 2. Where does this user stand?
  const budget = await getBudget(o.userId, db);
  let level: BudgetLevel | 'unknown' = budget ? budget.level : 'unknown';
  let reason: string | undefined = budget ? undefined : 'budget_unknown';
  if (level !== 'blocked' && await globalCapReached(db)) { level = 'blocked'; reason = 'global_cap'; }
  if (level === 'blocked') throw new BudgetExceededError(budget?.plan ?? 'free', o.now);

  // 3. Degrade instead of refusing.
  const degraded = level === 'degraded' || level === 'unknown';
  const wantModel = o.preferredModel ?? PRIMARY_MODEL();
  const model = degraded ? FALLBACK_MODEL() : wantModel;
  const maxOut = o.maxOutputTokens ?? 1024, ctxChars = o.contextChars ?? 24_000;
  const ctx: CallContext = {
    model, degraded,
    maxOutputTokens: degraded ? Math.min(maxOut, DEGRADED_MAX_OUTPUT) : maxOut,
    contextChars: degraded ? Math.min(ctxChars, DEGRADED_CONTEXT_CHARS) : ctxChars,
  };
  if (degraded && !reason) reason = 'budget_degraded';

  // 4. Call, then ledger. If the call throws nothing is charged and nothing is recorded.
  const out = await o.call(ctx);
  const cost = await recordUsage({ userId: o.userId, feature: o.feature, model: out.model || model, inputTokens: out.inputTokens, outputTokens: out.outputTokens, degraded, reason, db });
  if (o.cacheKey && out.text) await cacheSet(db, o.userId, o.cacheKey, out.text, ttl, out.model || model);
  return { text: out.text, model: out.model || model, source: 'llm', level, degraded, costUsd: cost };
}
