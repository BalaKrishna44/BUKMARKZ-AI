import { ANTHROPIC_MODEL } from './server';

type Json = Record<string, unknown>;

/**
 * Forced tool use => the model can only answer with JSON matching `schema`. Caller still validates
 * the result (zod) because a schema is a request, not a guarantee.
 * `content` may be plain text or Anthropic content blocks (used for images).
 */
export async function claudeTool<T = unknown>(opts: {
  system: string;
  content: string | Json[];
  toolName: string;
  schema: Json;
  maxTokens?: number;
  model?: string;
  signal?: AbortSignal;
}): Promise<T> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: opts.signal ?? AbortSignal.timeout(120_000),
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: opts.model ?? ANTHROPIC_MODEL,
      max_tokens: opts.maxTokens ?? 4096,
      system: opts.system,
      tools: [{ name: opts.toolName, description: 'Return the result.', input_schema: opts.schema }],
      tool_choice: { type: 'tool', name: opts.toolName },
      messages: [{ role: 'user', content: opts.content }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { content: { type: string; name?: string; input?: unknown }[]; stop_reason: string };
  const block = body.content.find((b) => b.type === 'tool_use' && b.name === opts.toolName);
  if (!block) throw new Error('model returned no tool call');
  if (body.stop_reason === 'max_tokens') throw new Error('model output truncated');
  return block.input as T;
}
