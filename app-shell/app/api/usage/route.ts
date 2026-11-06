import { json, requireUser } from '@/lib/server';
import { getUsage, GateUnavailableError } from '@/lib/planLimits';
import { getBudget } from '@/lib/ai/circuitBreaker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/usage: plan, this month's counters and caps, and a coarse AI-allowance level (never dollar amounts) for the settings page and upgrade nudges. */
export async function GET(req: Request) {
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401, { 'cache-control': 'no-store' });
  try {
    const [usage, budget] = await Promise.all([getUsage(user.id), getBudget(user.id)]);
    return json({ ...usage, ai: budget ? { level: budget.level, percent: Math.min(100, Math.round(budget.ratio * 100)) } : { level: 'unknown', percent: null } }, 200, { 'cache-control': 'no-store' });
  } catch (e) {
    if (e instanceof GateUnavailableError) return json({ error: e.code, message: e.message }, 503, { 'cache-control': 'no-store', 'retry-after': '5' });
    throw e;
  }
}
