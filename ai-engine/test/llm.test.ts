import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { callStructured, costUsd, LlmError, ValidationError } from '../src/llm.ts';
import { fakeLlm } from './helpers.ts';

const base = { model: 'claude-haiku-5-5', system: 'sys', content: 'hello', schema: { type: 'object' }, maxTokens: 100 };
const asString = (raw: unknown) => {
  if (typeof (raw as any)?.v !== 'string') throw new ValidationError('v must be a string');
  return (raw as any).v as string;
};

describe('callStructured', () => {
  it('returns the validated value with usage and cost', async () => {
    const llm = fakeLlm([{ json: { v: 'ok' }, usage: { input_tokens: 1000, output_tokens: 200 } }]);
    const r = await callStructured({ ...base, client: llm, validate: asString });
    assert.equal(r.value, 'ok');
    assert.equal(r.usage.input_tokens, 1000);
    assert.ok(Math.abs((r.costUsd ?? 0) - 0.0002) < 1e-12); // 1000 in x $0.10/M + 200 out x $0.50/M
  });

  it('sends the verified request shape and never sets sampling parameters', async () => {
    const llm = fakeLlm([{ json: { v: 'ok' } }]);
    await callStructured({ ...base, client: llm, validate: asString });
    const p = llm.calls[0]!.params;
    assert.deepEqual(p.thinking, { type: 'disabled' });
    assert.equal(p.output_config.effort, 'low');
    assert.equal(p.output_config.format.type, 'json_schema');
    for (const k of ['temperature', 'top_p', 'top_k']) assert.equal(k in p, false, `${k} must not be sent`);
  });

  it('treats rate limits and outages as retryable, and bad requests as configuration bugs', async () => {
    for (const status of [429, 500, 529]) {
      await assert.rejects(callStructured({ ...base, client: fakeLlm([{ error: { status } }]), validate: asString }), (e: any) => e instanceof LlmError && e.code === 'unavailable' && e.retryable);
    }
    await assert.rejects(callStructured({ ...base, client: fakeLlm([{ error: {} }]), validate: asString }), (e: any) => e.code === 'unavailable'); // no status = network
    for (const status of [400, 401, 403, 404]) {
      await assert.rejects(callStructured({ ...base, client: fakeLlm([{ error: { status } }]), validate: asString }), (e: any) => e.code === 'config' && !e.retryable);
    }
  });

  it('reports refusals and truncation without retrying', async () => {
    await assert.rejects(callStructured({ ...base, client: fakeLlm([{ stop_reason: 'refusal' }]), validate: asString }), (e: any) => e.code === 'refused' && !e.retryable);
    await assert.rejects(callStructured({ ...base, client: fakeLlm([{ stop_reason: 'max_tokens' }]), validate: asString }), (e: any) => e.code === 'truncated');
  });

  it('repairs invalid JSON once, with a hint, and adds up the usage of both calls', async () => {
    const llm = fakeLlm([{ text: 'not json {' }, { json: { v: 'fixed' } }]);
    const r = await callStructured({ ...base, client: llm, validate: asString });
    assert.equal(r.value, 'fixed');
    assert.equal(llm.calls.length, 2);
    assert.match(JSON.stringify(llm.calls[1]!.params.messages), /not valid JSON/);
    assert.equal(r.usage.input_tokens, 2000);
    await assert.rejects(callStructured({ ...base, client: fakeLlm([{ text: 'x' }, { text: 'y' }]), validate: asString }), (e: any) => e.code === 'invalid_output' && e.retryable);
  });

  it('repairs a validation failure once using the validator message', async () => {
    const llm = fakeLlm([{ json: { v: 5 } }, { json: { v: 'five' } }]);
    const r = await callStructured({ ...base, client: llm, validate: asString });
    assert.equal(r.value, 'five');
    assert.match(JSON.stringify(llm.calls[1]!.params.messages), /v must be a string/);
    await assert.rejects(callStructured({ ...base, client: fakeLlm([{ json: { v: 1 } }, { json: { v: 2 } }]), validate: asString }), (e: any) => e.code === 'invalid_output');
  });

  it('accepts JSON wrapped in a code fence', async () => {
    const r = await callStructured({ ...base, client: fakeLlm([{ text: '```json\n{"v":"fenced"}\n```' }]), validate: asString });
    assert.equal(r.value, 'fenced');
  });

  it('keeps image blocks in front of the text when a hint is added', async () => {
    const llm = fakeLlm([{ json: { v: 1 } }, { json: { v: 'ok' } }]);
    const content = [{ type: 'image', source: {} }, { type: 'text', text: 'caption' }];
    await callStructured({ ...base, client: llm, content, validate: asString });
    const second = llm.calls[1]!.params.messages[0].content;
    assert.deepEqual(second.map((b: any) => b.type), ['image', 'text', 'text']);
  });
});

describe('costUsd', () => {
  it('prices Haiku 5.5 and Sonnet 5.5 and knows when it cannot', () => {
    assert.ok(Math.abs(costUsd({ input_tokens: 1_000_000, output_tokens: 0 }, 'claude-haiku-5-5')! - 0.1) < 1e-9);
    assert.ok(Math.abs(costUsd({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, 'claude-sonnet-5-5')! - 12) < 1e-9);
    assert.equal(costUsd({ input_tokens: 5 }, 'some-future-model'), null);
  });
});
