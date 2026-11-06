import { PLAN_LIMITS, checkFeatureLimit, refundFeature, getUsage, LimitExceededError, GateUnavailableError, type RpcDb } from '../lib/planLimits';
import { costUsd, priceOf } from '../lib/ai/pricing';
import { assertBudget, recordUsage, budgetFor, evaluate, levelFor, guardedLLM, BudgetExceededError, cacheKeyFor, FALLBACK_MODEL, DEGRADED_MAX_OUTPUT } from '../lib/ai/circuitBreaker';
import { mcpLimitMessage } from '../lib/mcp/errors';
import { gateErrorResponse } from '../lib/http/limit';
import { upgradeUrlFor, safeUpgradeHref, isLimitInfo, readLimit, resetsAtISO } from '../lib/upgrade';

let passed = 0, failed = 0;
const ok = (c: unknown, m: string) => { if (c) { passed++; console.log('ok   ' + m); } else { failed++; console.log('FAIL ' + m); } };
const db = (fn: (name: string, a: any) => any): RpcDb => ({ async rpc(name, a) { try { const r = fn(name, a); return r && typeof r === 'object' && 'error' in r ? r : { data: r, error: null }; } catch (e) { return { data: null, error: { message: (e as Error).message } }; } } });

(async () => {
  // caps
  ok(PLAN_LIMITS.free.ask === 20 && PLAN_LIMITS.free.mcp === 50 && PLAN_LIMITS.free.index === 300, 'free caps: 20 Asks, 50 MCP, 300 indexed');
  ok(PLAN_LIMITS.pro.ask === 1000 && PLAN_LIMITS.pro.mcp === 10000 && PLAN_LIMITS.pro.index === 25000, 'pro caps: 1000 Asks, 10000 MCP, 25000 indexed');

  // checkFeatureLimit
  let sent: any = null;
  const allow = db((n, a) => { sent = { n, a }; return { allowed: true, plan: 'free', used: 3, limit: 20, granted: 1 }; });
  const g = await checkFeatureLimit('u1', 'ask', { db: allow });
  ok(g.used === 3 && g.limit === 20 && sent.n === 'gate_consume' && sent.a.p_feature === 'ask' && sent.a.p_amount === 1 && sent.a.p_limits === PLAN_LIMITS, 'allowed: returns counters; sends the single PLAN_LIMITS table');
  const deny = db(() => ({ allowed: false, plan: 'free', reason: 'monthly', used: 20, limit: 20 }));
  try { await checkFeatureLimit('u1', 'ask', { db: deny, now: new Date('2026-10-20T00:00:00Z') }); ok(false, 'denied should throw'); }
  catch (e) {
    const l = e as LimitExceededError;
    ok(l instanceof LimitExceededError && l.status === 402 && l.feature === 'ask' && l.used === 20 && l.limit === 20 && l.resetsAt === '2026-11-01T00:00:00.000Z' && /from=ask_limit/.test(l.upgradeUrl) && /plan=pro/.test(l.upgradeUrl), 'denied: structured LimitExceededError (402, reset date, upgrade URL)');
    ok(/Free plan limit reached: 20\/20 Asks this month/.test(l.message), 'denied: readable message');
    const j = JSON.parse(JSON.stringify(l)); ok(isLimitInfo(j) && j.reason === 'monthly', 'error serialises to the LimitInfo shape the UI reads');
  }
  try { await checkFeatureLimit('u1', 'snapshot', { db: db(() => ({ allowed: false, plan: 'free', reason: 'plan', used: 0, limit: 0 })) }); ok(false, 'throw'); }
  catch (e) { ok(/not included in the Free plan/.test((e as Error).message) && (e as LimitExceededError).resetsAt === null, 'limit 0 -> "not included" message, no reset date'); }
  for (const bad of [db(() => ({ error: { message: 'boom' } })), db(() => { throw new Error('net'); }), db(() => null), db(() => ({ allowed: false, plan: 'free', reason: 'not_configured' }))]) {
    try { await checkFeatureLimit('u1', 'ask', { db: bad }); ok(false, 'must fail closed'); } catch (e) { ok(e instanceof GateUnavailableError && (e as any).status === 503, 'gate failure -> GateUnavailableError (fail closed)'); }
  }
  for (const bad of [0, -1, 1.5, NaN]) { try { await checkFeatureLimit('u1', 'ask', { db: allow, amount: bad }); ok(false, 'bad amount'); } catch (e) { ok(e instanceof GateUnavailableError, `amount ${bad} rejected before any database call`); } }
  const part = await checkFeatureLimit('u1', 'index', { db: db(() => ({ allowed: true, plan: 'free', used: 300, limit: 300, granted: 50, partial: true })), amount: 120, partial: true });
  ok(part.granted === 50 && part.partial, 'index partial grant reported');
  let rf: any = null; await refundFeature('u1', 'ask', 1, db((n, a) => { rf = { n, a }; return null; }));
  ok(rf.n === 'gate_refund' && rf.a.p_amount === 1, 'refund calls gate_refund');
  await refundFeature('u1', 'ask', 1, db(() => { throw new Error('x'); })); ok(true, 'refund never throws');
  const us = await getUsage('u1', db(() => ({ plan: 'pro', month: '2026-10', features: { ask: { used: 1, limit: 1000 } } }))); ok(us.plan === 'pro', 'getUsage passes through');

  // pricing
  ok(Math.abs(costUsd('claude-haiku-5-5', 1_000_000, 1_000_000) - 0.6) < 1e-9, 'haiku: $0.10 in + $0.50 out per million');
  ok(priceOf('mystery-model').known === false && costUsd('mystery-model', 1_000_000, 0) >= costUsd('claude-sonnet-5-5', 1_000_000, 0), 'unknown model billed at the conservative fallback');
  ok(costUsd('claude-haiku-5-5', -5, 2.9) === costUsd('claude-haiku-5-5', 0, 2), 'negative/fractional tokens clamped');
  process.env.AI_PRICE_OVERRIDES = '{"claude-sonnet-5-5":{"in":1,"out":2},"bad":{"in":-1,"out":1}}';
  ok(costUsd('claude-sonnet-5-5', 1_000_000, 1_000_000) === 3 && priceOf('bad').known === false, 'AI_PRICE_OVERRIDES applied; invalid entries ignored');
  delete process.env.AI_PRICE_OVERRIDES;

  // budget math
  ok(budgetFor('pro') === 0.5 && budgetFor('team') === 3.2475 && budgetFor('free') === 0.2, 'budgets: 25% of $2 = $0.50, 25% of $12.99 = $3.2475, free $0.20');
  ok(budgetFor('pro', 120 / 12 * 0.8) === 2, 'real (discounted) price used when known');
  ok(levelFor(0.79) === 'ok' && levelFor(0.8) === 'warn' && levelFor(1) === 'degraded' && levelFor(1.99) === 'degraded' && levelFor(2) === 'blocked', 'levels: ok <80%, warn, degraded >=100%, blocked >=200%');
  ok(evaluate('pro', 0.5).level === 'degraded' && evaluate('pro', 0.39).level === 'ok' && evaluate('pro', 0.45).level === 'warn', 'pro: $0.50 is the 25% line');

  // breaker
  const mk = (spent: number, plan = 'pro', extra: Record<string, any> = {}) => {
    const log: any[] = []; const cache = new Map<string, string>();
    const d = db((n, a) => {
      log.push({ n, a });
      if (n === 'ai_budget_state') return extra.budgetErr ? { error: { message: 'x' } } : { plan, spent_usd: spent, monthly_price_usd: null };
      if (n === 'ai_cache_get') return cache.get(a.p_key) ?? null;
      if (n === 'ai_cache_set') { cache.set(a.p_key, a.p_value); return null; }
      if (n === 'ai_global_spend') return extra.global ?? 0;
      if (n === 'ai_ledger_record') return 0;
      return null;
    });
    return { d, log, cache };
  };
  const llm = (ctxs: any[]) => async (ctx: any) => { ctxs.push(ctx); return { text: 'answer', model: ctx.model, inputTokens: 1000, outputTokens: 200 }; };
  let ctxs: any[] = []; let t = mk(0.2);
  let r = await guardedLLM({ userId: 'u', feature: 'ask', db: t.d, preferredModel: 'claude-sonnet-5-5', call: llm(ctxs) });
  ok(r.source === 'llm' && !r.degraded && ctxs[0].model === 'claude-sonnet-5-5' && ctxs[0].maxOutputTokens === 1024, 'ok level: preferred model, full limits');
  const led = t.log.find((x) => x.n === 'ai_ledger_record');
  ok(led && led.a.p_model === 'claude-sonnet-5-5' && led.a.p_in === 1000 && led.a.p_out === 200 && led.a.p_cost > 0 && led.a.p_degraded === false, 'every request is written to the ledger with tokens and cost');
  ctxs = []; t = mk(0.6);
  r = await guardedLLM({ userId: 'u', feature: 'ask', db: t.d, preferredModel: 'claude-sonnet-5-5', maxOutputTokens: 2000, contextChars: 20000, call: llm(ctxs) });
  ok(r.degraded && ctxs[0].model === FALLBACK_MODEL() && ctxs[0].maxOutputTokens === DEGRADED_MAX_OUTPUT && ctxs[0].contextChars <= 6000, 'over 25% of plan price: Haiku, smaller output + context');
  ok(t.log.find((x) => x.n === 'ai_ledger_record')!.a.p_degraded === true, 'degraded requests are flagged in the ledger');
  ctxs = []; t = mk(0, 'pro', { budgetErr: true });
  r = await guardedLLM({ userId: 'u', feature: 'ask', db: t.d, call: llm(ctxs) });
  ok(r.degraded && r.level === 'unknown', 'budget lookup fails -> degraded, not unlimited');
  t = mk(1.2); try { await guardedLLM({ userId: 'u', feature: 'ask', db: t.d, call: llm([]) }); ok(false, 'blocked should throw'); }
  catch (e) { ok(e instanceof BudgetExceededError && (e as BudgetExceededError).status === 402 && !t.log.some((x) => x.n === 'ai_ledger_record'), 'over 2x: BudgetExceededError, no model call, nothing logged'); }
  t = mk(1.2); t.cache.set('k1', 'cached answer'); ctxs = [];
  r = await guardedLLM({ userId: 'u', feature: 'ask', db: t.d, cacheKey: 'k1', call: llm(ctxs) });
  ok(r.source === 'cache' && r.text === 'cached answer' && ctxs.length === 0 && r.costUsd === 0, 'blocked user still gets a cached answer, at zero cost');
  t = mk(0.05); r = await guardedLLM({ userId: 'u', feature: 'ask', db: t.d, cacheKey: 'k2', call: llm([]) });
  ok(t.cache.get('k2') === 'answer', 'fresh answers are cached');
  process.env.AI_GLOBAL_MONTHLY_CAP_USD = '100'; t = mk(0, 'pro', { global: 150 });
  try { await guardedLLM({ userId: 'u', feature: 'ask', db: t.d, call: llm([]) }); ok(false, 'kill switch'); } catch (e) { ok(e instanceof BudgetExceededError, 'global monthly cap acts as a kill switch'); }
  delete process.env.AI_GLOBAL_MONTHLY_CAP_USD;
  t = mk(0.05); try { await guardedLLM({ userId: 'u', feature: 'ask', db: t.d, call: async () => { throw new Error('provider down'); } }); } catch { /* expected */ }
  ok(!t.log.some((x) => x.n === 'ai_ledger_record'), 'failed model call is not billed or logged');
  const k1 = await cacheKeyFor('ask', 'What  is Postgres?'), k2 = await cacheKeyFor('ask', 'what is postgres?'), k3 = await cacheKeyFor('ask', 'other');
  ok(k1 === k2 && k1 !== k3 && /^[0-9a-f]{64}$/.test(k1), 'cache key: normalised, stable, sha-256');

  // assertBudget: pre-flight for batch workers / vision / podcast
  let a = await assertBudget('u', mk(0.1).d); ok(!a.degraded && a.level === 'ok', 'assertBudget: under budget passes');
  a = await assertBudget('u', mk(0.6).d); ok(a.degraded && a.level === 'degraded', 'assertBudget: pro over 100% -> allowed but degraded (cheap model)');
  try { await assertBudget('u', mk(1.2).d); ok(false, 'pro blocked'); } catch (e) { ok(e instanceof BudgetExceededError, 'assertBudget: pro over 200% -> BudgetExceededError'); }
  try { await assertBudget('u', mk(0.25, 'free').d); ok(false, 'free blocked'); } catch (e) { ok(e instanceof BudgetExceededError && (e as BudgetExceededError).plan === 'free', 'assertBudget: FREE stops at 100% of its $0.20 allowance'); }
  a = await assertBudget('u', mk(0, 'pro', { budgetErr: true }).d); ok(a.degraded && a.level === 'unknown', 'assertBudget: budget unreadable -> degraded, not unlimited');
  process.env.AI_GLOBAL_MONTHLY_CAP_USD = '100';
  try { await assertBudget('u', mk(0, 'pro', { global: 150 }).d); ok(false, 'kill'); } catch (e) { ok(e instanceof BudgetExceededError, 'assertBudget: global cap kill switch'); }
  delete process.env.AI_GLOBAL_MONTHLY_CAP_USD;

  // MCP messages and HTTP
  const msg = mcpLimitMessage('free', 50, 50, new Date('2026-10-20T00:00:00Z'));
  ok(msg.startsWith('Free tier limit reached (50/50 calls') && /10,000 MCP calls a month/.test(msg) && msg.endsWith('/pricing'), 'MCP free message: counts, Pro pitch, one trailing link');
  ok(/Pro plan limit reached \(10,000\/10,000/.test(mcpLimitMessage('pro', 10000, 10000)), 'MCP pro-at-cap message');
  const e402 = gateErrorResponse(new LimitExceededError('ask', 'free', 20, 20, 'monthly'))!;
  ok(e402.status === 402 && (await e402.json()).error === 'limit_exceeded', 'HTTP: LimitExceededError -> 402 JSON');
  const e402b = gateErrorResponse(new BudgetExceededError('free'))!; ok(e402b.status === 402, 'HTTP: BudgetExceededError -> 402');
  const e503 = gateErrorResponse(new GateUnavailableError())!; ok(e503.status === 503 && e503.headers.get('retry-after') === '5', 'HTTP: gate outage -> 503 + Retry-After');
  ok(gateErrorResponse(new Error('x')) === null, 'HTTP: other errors pass through');
  ok(isLimitInfo(await readLimit(new Response(JSON.stringify(new LimitExceededError('ask', 'free', 1, 1, 'monthly').toJSON()), { status: 402 }))), 'client: readLimit parses a 402');
  ok((await readLimit(new Response('{}', { status: 200 }))) === null && (await readLimit(new Response('nope', { status: 402 }))) === null, 'client: readLimit ignores non-402 and junk');
  ok(safeUpgradeHref('https://evil.example/pricing') === 'https://bukmarkz.com/pricing' && safeUpgradeHref('javascript:alert(1)') === 'https://bukmarkz.com/pricing' && safeUpgradeHref(upgradeUrlFor('mcp', 'free')).startsWith('https://bukmarkz.com/pricing?'), 'client: upgrade links never leave our origin');
  ok(resetsAtISO(new Date('2026-12-31T23:59:59Z')) === '2027-01-01T00:00:00.000Z', 'reset date rolls over the year');
  console.log(`${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
