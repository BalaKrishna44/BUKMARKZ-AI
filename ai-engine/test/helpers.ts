import type { LlmClient } from '../src/types.ts';

export type Scripted =
  | { json: unknown; usage?: Record<string, number>; stop_reason?: string }
  | { text: string; usage?: Record<string, number> }
  | { stop_reason: 'refusal' | 'max_tokens'; usage?: Record<string, number> }
  | { error: { status?: number } };

export interface FakeLlm extends LlmClient {
  calls: Array<{ params: any; options: any }>;
}

/** A pretend Anthropic client that returns the scripted replies in order and records every request. */
export function fakeLlm(script: Scripted[]): FakeLlm {
  const calls: FakeLlm['calls'] = [];
  const queue = [...script];
  return {
    calls,
    messages: {
      create: async (params: any, options?: any) => {
        calls.push({ params, options });
        const next = queue.shift();
        if (!next) throw new Error('fakeLlm: no scripted reply left (the code made more calls than the test expected)');
        if ('error' in next) throw Object.assign(new Error('api error'), next.error);
        const usage = next.usage ?? { input_tokens: 1000, output_tokens: 200 };
        if ('stop_reason' in next && !('json' in next)) return { content: [], stop_reason: next.stop_reason, usage };
        const text = 'json' in next ? JSON.stringify(next.json) : next.text;
        return { content: [{ type: 'text', text }], stop_reason: 'end_turn', usage };
      },
    },
  };
}

/** Text of the first block of the first user message (what the model would read). */
export function userText(call: { params: any }): string {
  const content = call.params.messages[0].content;
  const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : content;
  return blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
}
