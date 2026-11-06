import { EMBEDDING } from './config.ts';

export interface Embedder {
  readonly model: string;
  readonly dimensions: number;
  /** One vector per input text, same order. */
  embed(texts: string[]): Promise<number[][]>;
}

export class EmbeddingError extends Error {
  retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'EmbeddingError';
    this.retryable = retryable;
  }
}

export interface OpenAiEmbedderOptions {
  apiKey: string;
  model?: string;
  dimensions?: number;
  baseUrl?: string;
  /** injectable for tests */
  fetch?: typeof fetch;
  maxAttempts?: number;
}

const BATCH_SIZE = 96;
const MAX_INPUT_CHARS = 20_000; // the model's limit is about 8k tokens

/**
 * OpenAI embeddings: the same model the Django search used, so old and new vectors stay comparable.
 * (Anthropic has no embeddings endpoint. Voyage AI is its recommended partner: swap in by implementing `Embedder`.)
 */
export class OpenAiEmbedder implements Embedder {
  readonly model: string;
  readonly dimensions: number;
  private apiKey: string;
  private baseUrl: string;
  private doFetch: typeof fetch;
  private maxAttempts: number;

  constructor(options: OpenAiEmbedderOptions) {
    if (!options.apiKey) throw new Error('OpenAiEmbedder needs an apiKey');
    this.apiKey = options.apiKey;
    this.model = options.model ?? EMBEDDING.model;
    this.dimensions = options.dimensions ?? EMBEDDING.dimensions;
    this.baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.doFetch = options.fetch ?? fetch;
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      out.push(...(await this.embedBatch(texts.slice(i, i + BATCH_SIZE))));
    }
    return out;
  }

  private async embedBatch(batch: string[]): Promise<number[][]> {
    const input = batch.map((t) => (t.trim() ? t.slice(0, MAX_INPUT_CHARS) : ' '));
    let lastError: EmbeddingError | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const res = await this.doFetch(`${this.baseUrl}/embeddings`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify({ model: this.model, input, dimensions: this.dimensions, encoding_format: 'float' }),
          signal: AbortSignal.timeout(30_000),
        });
        if (res.status === 429 || res.status >= 500) {
          lastError = new EmbeddingError(`Embedding service busy (HTTP ${res.status})`, true);
        } else if (!res.ok) {
          throw new EmbeddingError(`Embedding request rejected (HTTP ${res.status})`, false); // bad key / model / input: don't retry
        } else {
          const body = (await res.json()) as { data?: Array<{ index: number; embedding: number[] }> };
          const data = [...(body.data ?? [])].sort((a, b) => a.index - b.index);
          if (data.length !== input.length) throw new EmbeddingError('Embedding response had the wrong number of vectors', true);
          for (const d of data) {
            if (!Array.isArray(d.embedding) || d.embedding.length !== this.dimensions) {
              throw new EmbeddingError(`Expected ${this.dimensions}-dimension vectors (the database column size)`, false);
            }
          }
          return data.map((d) => d.embedding);
        }
      } catch (err) {
        if (err instanceof EmbeddingError && !err.retryable) throw err;
        lastError = err instanceof EmbeddingError ? err : new EmbeddingError('Could not reach the embedding service', true);
      }
      if (attempt < this.maxAttempts) await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1)));
    }
    throw lastError ?? new EmbeddingError('Embedding failed', true);
  }
}

/** pgvector's text format: "[0.1,0.2,...]". Rejects NaN/Infinity, which would otherwise corrupt the column. */
export function toPgVector(v: number[]): string {
  for (const x of v) if (!Number.isFinite(x)) throw new EmbeddingError('Vector contains a non-finite number', false);
  return `[${v.join(',')}]`;
}
