import { PLAN_LIMITS, type PlanId } from '../planLimits';
import { PRICING_URL, resetsAtISO } from '../upgrade';

/**
 * Text an MCP client (Claude Desktop, Cursor) shows its user when a tool call is refused. Tool errors, not protocol errors, so the model can
 * read the message and explain it. Keep each one short, concrete and ending with exactly one link.
 */
const fmt = (n: number) => n.toLocaleString('en-US');

export function mcpLimitMessage(plan: PlanId, used: number, limit: number, now = new Date()): string {
  if (plan === 'free') {
    return `Free tier limit reached (${fmt(used)}/${fmt(limit)} calls; resets ${resetsAtISO(now).slice(0, 10)} UTC). Upgrade to Pro for ${fmt(PLAN_LIMITS.pro.mcp ?? 0)} MCP calls a month and saving from your editor: ${PRICING_URL}`;
  }
  return `${plan === 'team' ? 'Team' : 'Pro'} plan limit reached (${fmt(used)}/${fmt(limit)} MCP calls this month). It resets on ${resetsAtISO(now).slice(0, 10)} (UTC). Need more? ${PRICING_URL}`;
}

export const mcpWriteDeniedMessage = `Saving bookmarks over MCP needs the Bukmarkz Pro plan (the Free plan is read-only). Upgrade: ${PRICING_URL}`;

export function mcpLimitData(plan: PlanId, used: number, limit: number, now = new Date()) {
  return { error: 'limit_exceeded', feature: 'mcp', plan, used, limit, upgradeUrl: `${PRICING_URL}?plan=${plan === 'free' ? 'pro' : 'team'}&from=mcp_limit`, resetsAt: resetsAtISO(now) };
}
