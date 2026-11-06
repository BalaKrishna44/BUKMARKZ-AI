import 'server-only';
import { BudgetExceededError, cacheKeyFor, guardedLLM } from '@/lib/ai/circuitBreaker';
import { summaryPrompt, type TabIn } from './core';

/** Haiku via the cost circuit breaker (plan-gating/lib/ai/circuitBreaker.ts): ledgered, cached, and refused (null) when the user is over budget. */
export const SUMMARY_MODEL = () => process.env.SESSION_SUMMARY_MODEL ?? 'claude-haiku-5-5';

export async function summarizeTabs(userId: string, tabs: TabIn[]): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const p = summaryPrompt(tabs);
  try {
    const r = await guardedLLM({
      userId, feature: 'session_summary', preferredModel: SUMMARY_MODEL(), maxOutputTokens: 160, contextChars: 8000,
      cacheKey: await cacheKeyFor('session_summary', ...p.cacheKeyParts),
      call: async (ctx) => {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST', signal: AbortSignal.timeout(15_000),
          headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: ctx.model, max_tokens: ctx.maxOutputTokens, system: p.system, messages: [{ role: 'user', content: p.user.slice(0, ctx.contextChars) }] }),
        });
        if (!res.ok) throw new Error(`anthropic ${res.status}`);
        const j = await res.json() as { content?: { type: string; text?: string }[]; model?: string; usage?: { input_tokens?: number; output_tokens?: number } };
        return { text: j.content?.find((c) => c.type === 'text')?.text ?? '', model: j.model ?? ctx.model, inputTokens: j.usage?.input_tokens ?? 0, outputTokens: j.usage?.output_tokens ?? 0 };
      },
    });
    return r.text;
  } catch (e) {
    if (!(e instanceof BudgetExceededError)) console.error('session summary failed', (e as Error).message);
    return null;
  }
}
