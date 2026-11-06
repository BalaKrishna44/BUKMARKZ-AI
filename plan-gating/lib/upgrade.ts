/**
 * Client-safe upgrade helpers (no server imports). Used by the limit errors, the HTTP layer, the MCP messages and <UpgradePrompt/>.
 */
export type PlanId = 'free' | 'pro' | 'team';
export type Feature = 'ask' | 'mcp' | 'index' | 'snapshot';

export const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://bukmarkz.com').replace(/\/$/, '');
export const PRICING_URL = `${SITE}/pricing`;

/** Which plan to pitch. Free users see Pro; Pro users who hit a cap see Team. Team has nowhere higher to go. */
export const nextPlan = (plan: PlanId): PlanId | null => (plan === 'free' ? 'pro' : plan === 'pro' ? 'team' : null);

/** /pricing with enough context for analytics and for the pricing page to highlight the right tier. Contains no personal data. */
export function upgradeUrlFor(feature: Feature, plan: PlanId): string {
  const to = nextPlan(plan) ?? 'team';
  return `${PRICING_URL}?plan=${to}&from=${feature}_limit`;
}

/** First instant of next month, UTC: when monthly counters reset. */
export function resetsAtISO(now = new Date()): string { return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(); }

/** Shape of the JSON body of an HTTP 402 from our API (mirror of LimitExceededError.toJSON). */
export interface LimitInfo {
  error: 'limit_exceeded'; message: string; feature: Feature; plan: PlanId; used: number; limit: number;
  reason: 'monthly' | 'total' | 'plan'; upgradeUrl: string; resetsAt: string | null;
}
export interface BudgetInfo { error: 'ai_budget_exceeded'; message: string; plan: PlanId; upgradeUrl: string; resetsAt: string }

export function isLimitInfo(x: unknown): x is LimitInfo {
  const o = x as any;
  return !!o && typeof o === 'object' && o.error === 'limit_exceeded' && typeof o.feature === 'string' && typeof o.message === 'string' && typeof o.upgradeUrl === 'string';
}
export function isBudgetInfo(x: unknown): x is BudgetInfo {
  const o = x as any;
  return !!o && typeof o === 'object' && o.error === 'ai_budget_exceeded' && typeof o.message === 'string';
}

/** Client helper: after fetch(), `const limit = await readLimit(res)`; show <UpgradePrompt info={limit}/> when it is not null. */
export async function readLimit(res: Response): Promise<LimitInfo | BudgetInfo | null> {
  if (res.status !== 402) return null;
  try { const b = await res.clone().json(); return isLimitInfo(b) || isBudgetInfo(b) ? b : null; } catch { return null; }
}

/** Only ever navigate to our own pricing page, even if a response was tampered with. */
export const safeUpgradeHref = (url: string): string => { try { const u = new URL(url); return u.origin === new URL(SITE).origin ? u.toString() : PRICING_URL; } catch { return PRICING_URL; } };

export const FEATURE_LABEL: Record<Feature, string> = { ask: 'Ask your vault', mcp: 'Vault MCP', index: 'AI indexing', snapshot: 'Page snapshots' };
export const PITCH: Record<Feature, string> = {
  ask: 'Pro includes 1,000 Asks a month.',
  mcp: 'Pro includes 10,000 MCP calls a month, plus saving from your editor.',
  index: 'Pro indexes up to 25,000 bookmarks with AI.',
  snapshot: 'Pro keeps up to 500 page snapshots a month, so links never rot.',
};
