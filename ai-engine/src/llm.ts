/**
 * One place that talks to Claude: structured JSON out, honest failure modes, real cost numbers.
 *
 * Request shape (verified against Anthropic's docs for the 5.x models):
 *  - output_config.format = json_schema  -> the reply is valid JSON for the schema.
 *    Unsupported in schemas: minItems/maxItems (beyond 0/1), maxLength and friends, so counts and lengths are enforced
 *    in code (or by the schema's structure: see the fixed step_1/step_2/step_3 keys in checklist.ts).
 *    Every property must be listed in "required". Don't add a "reasoning" field: it can trigger a refusal.
 *  - thinking disabled + low effort: these are extraction jobs, thinking tokens would only add cost.
 *  - NO temperature / top_p / top_k: Claude 4.7 and later reject non-default values with a 400.
 */
import { PRICING } from './config.ts';
import type { LlmClient, Usage } from './types.ts';

export type { LlmClient } from './types.ts';

export type LlmErrorCode =
  | 'config' //         our request is wrong (bad key, retired model, malformed request): fix the code, never retry
  | 'unavailable' //    rate limit / overload / network: try again later
  | 'refused' //        the model declined this content: retrying won't help
  | 'truncated' //      hit max_tokens: the JSON is cut off
  | 'invalid_output'; // reply was not usable even after one repair attempt

export class LlmError extends Error {
  code: LlmErrorCode;
  retryable: boolean;
  constructor(code: LlmErrorCode, message: string, retryable: boolean, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LlmError';
    this.code = code;
    this.retryable = retryable;
  }
}

/** Throw this from a `validate` function to trigger one repair attempt with your message as the hint. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function costUsd(usage: Usage, model: string): number | null {
  const p = PRICING[model];
  if (!p) return null;
  const input = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) * 1.25 + (usage.cache_read_input_tokens ?? 0) * 0.1;
  return (input * p.inputPerMTok + (usage.output_tokens ?? 0) * p.outputPerMTok) / 1_000_000;
}

export interface StructuredCall<T> {
  client: LlmClient;
  model: string;
  system: string;
  /** Plain text, or content blocks (put an image block BEFORE the text: Anthropic recommends image-then-text). */
  content: string | unknown[];
  schema: object;
  maxTokens: number;
  effort?: 'low' | 'medium' | 'high';
  /** Turn parsed JSON into your type. Throw ValidationError for fixable problems. */
  validate: (raw: unknown) => T;
  timeoutMs?: number;
  maxRetries?: number;
  onUsage?: (info: { model: string; usage: Usage; costUsd: number | null }) => void;
}

export interface StructuredResult<T> {
  value: T;
  usage: Usage;
  costUsd: number | null;
}

function statusOf(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const n = Number((err as { status: unknown }).status);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function toBlocks(content: string | unknown[]): unknown[] {
  return typeof content === 'string' ? [{ type: 'text', text: content }] : content;
}

function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(trimmed);
}

function addUsage(a: Usage, b: Usage | undefined): Usage {
  return {
    input_tokens: (a.input_tokens ?? 0) + (b?.input_tokens ?? 0),
    output_tokens: (a.output_tokens ?? 0) + (b?.output_tokens ?? 0),
    cache_read_input_tokens: (a.cache_read_input_tokens ?? 0) + (b?.cache_read_input_tokens ?? 0),
    cache_creation_input_tokens: (a.cache_creation_input_tokens ?? 0) + (b?.cache_creation_input_tokens ?? 0),
  };
}

export async function callStructured<T>(c: StructuredCall<T>): Promise<StructuredResult<T>> {
  let hint: string | undefined;
  let total: Usage = {};

  for (let attempt = 1; attempt <= 2; attempt++) {
    const params = {
      model: c.model,
      max_tokens: c.maxTokens,
      system: c.system,
      messages: [{ role: 'user', content: hint ? [...toBlocks(c.content), { type: 'text', text: hint }] : c.content }],
      thinking: { type: 'disabled' },
      output_config: { effort: c.effort ?? 'low', format: { type: 'json_schema', schema: c.schema } },
    };

    let response: any;
    try {
      response = await c.client.messages.create(params, { timeout: c.timeoutMs ?? 60_000, maxRetries: c.maxRetries ?? 2 });
    } catch (err) {
      const status = statusOf(err);
      const transient = status === undefined || status === 408 || status === 409 || status === 429 || status >= 500;
      if (!transient) throw new LlmError('config', `Anthropic rejected the request (HTTP ${status})`, false, { cause: err });
      throw new LlmError('unavailable', `Anthropic unavailable (${status ?? 'network'})`, true, { cause: err });
    }

    total = addUsage(total, response?.usage);
    c.onUsage?.({ model: c.model, usage: response?.usage ?? {}, costUsd: costUsd(response?.usage ?? {}, c.model) });

    if (response?.stop_reason === 'refusal') throw new LlmError('refused', 'The model declined to process this content', false);
    if (response?.stop_reason === 'max_tokens') throw new LlmError('truncated', 'The answer was cut off at max_tokens', false);

    const block = Array.isArray(response?.content) ? response.content.find((b: any) => b?.type === 'text') : undefined;
    let parsed: unknown;
    try {
      if (typeof block?.text !== 'string') throw new Error('no text block');
      parsed = parseJson(block.text);
    } catch {
      if (attempt === 2) throw new LlmError('invalid_output', 'The reply was not valid JSON', true);
      hint = 'Your previous reply was not valid JSON. Reply with the JSON object only.';
      continue;
    }

    try {
      return { value: c.validate(parsed), usage: total, costUsd: costUsd(total, c.model) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof ValidationError && attempt === 1) {
        hint = `Your previous reply failed validation: ${message}. Fix it and reply with the JSON object only.`;
        continue;
      }
      throw new LlmError('invalid_output', `The reply failed validation: ${message}`, true, { cause: err });
    }
  }
  throw new LlmError('invalid_output', 'Unreachable', true);
}

/** Real client for production code. The SDK reads ANTHROPIC_API_KEY from the environment. */
export async function createAnthropicClient(): Promise<LlmClient> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  return new Anthropic() as unknown as LlmClient;
}
