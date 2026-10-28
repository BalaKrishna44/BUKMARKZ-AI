/**
 * Models and prices in one place.
 *
 * NOT "claude-3-5-sonnet-*": Claude 3.5 Sonnet was retired on Oct 28, 2025, and requests to it fail.
 * Haiku 5.5 does the cheap high-volume work (OCR, tags, checklists, query parsing); Sonnet 5.5 writes the answers the
 * user reads. Swap `smart` to Haiku if you want the whole pipeline at the lowest price.
 */
export const MODELS = {
  fast: 'claude-haiku-5-5',
  smart: 'claude-sonnet-5-5',
} as const;

export interface Pricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

/** Dollars per million tokens (base prices from Anthropic's models overview). Check them when you deploy. */
export const PRICING: Record<string, Pricing> = {
  'claude-haiku-5-5': { inputPerMTok: 0.1, outputPerMTok: 0.5 },
  'claude-sonnet-5-5': { inputPerMTok: 2, outputPerMTok: 10 },
};

/** The embedding model must produce vectors of exactly `dimensions` numbers: it has to match vector(1536) in the SQL. */
export const EMBEDDING = { model: 'text-embedding-3-small', dimensions: 1536 } as const;
