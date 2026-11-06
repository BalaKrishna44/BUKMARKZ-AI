/**
 * USD per million tokens. VERIFY against the providers' pricing pages before you rely on the dollar figures: prices change.
 * Override any entry without a deploy:  AI_PRICE_OVERRIDES='{"claude-sonnet-5-5":{"in":3,"out":15}}'
 * A model that is not listed is billed at FALLBACK (deliberately high), so a new model can only make the breaker trip early, never late.
 */
export interface ModelPrice { in: number; out: number }

export const PRICES: Record<string, ModelPrice> = {
  'claude-haiku-5-5': { in: 0.10, out: 0.50 },          // prompts <= 100k tokens (higher above that: see FALLBACK note in README)
  'claude-sonnet-5-5': { in: 3, out: 15 },              // PLACEHOLDER: set the real price via AI_PRICE_OVERRIDES
  'whisper-1': { in: 100, out: 0 },                      // Voice-to-Vault records AUDIO SECONDS as inputTokens: $0.006/min = $100 per million seconds (verify)
  'text-embedding-3-small': { in: 0.02, out: 0 },       // from memory, unverified
  'gemini-2.5-flash': { in: 0.30, out: 2.50 },          // PLACEHOLDER from memory, unverified: verify on Google's pricing page
};
export const FALLBACK: ModelPrice = { in: 5, out: 25 };

function overrides(): Record<string, ModelPrice> {
  try {
    const raw = process.env.AI_PRICE_OVERRIDES;
    if (!raw) return {};
    const o = JSON.parse(raw), out: Record<string, ModelPrice> = {};
    for (const [k, v] of Object.entries(o as Record<string, any>)) if (v && Number.isFinite(v.in) && Number.isFinite(v.out) && v.in >= 0 && v.out >= 0) out[k] = { in: v.in, out: v.out };
    return out;
  } catch { return {}; }
}

export function priceOf(model: string): { price: ModelPrice; known: boolean } {
  const p = overrides()[model] ?? PRICES[model];
  return p ? { price: p, known: true } : { price: FALLBACK, known: false };
}

/** Cost of one request in USD, rounded up to a millionth of a dollar. Negative or fractional token counts are clamped. */
export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const { price } = priceOf(model);
  const i = Math.max(0, Math.floor(inputTokens) || 0), o = Math.max(0, Math.floor(outputTokens) || 0);
  return Math.ceil(((i * price.in + o * price.out) / 1_000_000) * 1e6) / 1e6;
}
