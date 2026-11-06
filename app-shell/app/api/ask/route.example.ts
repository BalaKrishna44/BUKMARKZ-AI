// Rename to route.ts and wire in your retrieval + model call. Shows the order that keeps the margin safe:
//   1) authenticate  2) validate input (a bad request is never charged)  3) check + count the plan limit  4) breaker-guarded LLM call  5) refund on OUR failure
import { json, requireUser } from '@/lib/server';
import { checkFeatureLimit, refundFeature } from '@/lib/planLimits';
import { guardedLLM, cacheKeyFor } from '@/lib/ai/circuitBreaker';
import { gateErrorResponse } from '@/lib/http/limit';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const body = await req.json().catch(() => null);
  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  if (question.length < 3 || question.length > 1000) return json({ error: 'invalid_question' }, 400);      // not charged

  let counted = false;
  try {
    await checkFeatureLimit(user.id, 'ask');                // throws LimitExceededError (402) or GateUnavailableError (503)
    counted = true;
    const key = await cacheKeyFor('ask', question /* + a version/hash of the user's vault so edits invalidate the cache */);
    const r = await guardedLLM({
      userId: user.id, feature: 'ask', cacheKey: key,
      call: async ({ model, maxOutputTokens, contextChars }) => {
        // const context = await retrieve(user.id, question, { maxChars: contextChars });
        // const out = await anthropic.messages.create({ model, max_tokens: maxOutputTokens, system: ..., messages: [...] });
        // return { text: out.content[0].text, model, inputTokens: out.usage.input_tokens, outputTokens: out.usage.output_tokens };
        throw new Error('wire the model call here');
      },
    });
    if (r.source === 'cache') await refundFeature(user.id, 'ask');         // optional: a cache hit cost us nothing, so do not spend the user's Ask
    return json({ answer: r.text, degraded: r.degraded, source: r.source });
  } catch (e) {
    const limited = gateErrorResponse(e);
    if (limited) { if (counted) await refundFeature(user.id, 'ask'); return limited; }     // budget block after the count: give the Ask back
    if (counted) await refundFeature(user.id, 'ask');
    console.error('ask failed', (e as Error).message);
    return json({ error: 'internal' }, 500);
  }
}
