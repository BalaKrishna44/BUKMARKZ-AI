import { LimitExceededError, GateUnavailableError } from '../planLimits';
import { BudgetExceededError } from '../ai/circuitBreaker';

const H = { 'content-type': 'application/json', 'cache-control': 'no-store' };

/**
 * One catch-all for route handlers:
 *   try { await checkFeatureLimit(...); ... } catch (e) { const r = gateErrorResponse(e); if (r) return r; throw e; }
 * Limit hit -> 402 with a structured body the UI turns into <UpgradePrompt/>. Gate down -> 503 (we never serve unmetered). Anything else -> null.
 */
export function gateErrorResponse(e: unknown): Response | null {
  if (e instanceof LimitExceededError) return new Response(JSON.stringify(e.toJSON()), { status: 402, headers: H });
  if (e instanceof BudgetExceededError) return new Response(JSON.stringify(e.toJSON()), { status: 402, headers: H });
  if (e instanceof GateUnavailableError) return new Response(JSON.stringify({ error: e.code, message: e.message }), { status: 503, headers: { ...H, 'retry-after': '5' } });
  return null;
}
