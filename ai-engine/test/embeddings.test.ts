import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EmbeddingError, OpenAiEmbedder, toPgVector } from '../src/embeddings.ts';

const vec = (seed: number, dims = 1536) => Array.from({ length: dims }, (_, i) => (i + seed) / 10_000);
function fakeFetch(handler: (body: any, call: number) => { status: number; json?: unknown }) {
  const calls: any[] = [];
  const f = (async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    calls.push({ body, headers: init.headers });
    const r = handler(body, calls.length);
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.json } as Response;
  }) as unknown as typeof fetch;
  return { f, calls };
}
const okBody = (n: number, reverse = false) => {
  const data = Array.from({ length: n }, (_, i) => ({ index: i, embedding: vec(i) }));
  return { data: reverse ? data.reverse() : data };
};

describe('OpenAiEmbedder', () => {
  it('returns vectors in input order even if the API reorders them, and asks for the right size', async () => {
    const { f, calls } = fakeFetch((b) => ({ status: 200, json: okBody(b.input.length, true) }));
    const out = await new OpenAiEmbedder({ apiKey: 'k', fetch: f }).embed(['a', 'b', 'c']);
    assert.equal(out.length, 3);
    assert.deepEqual(out[2], vec(2));
    assert.equal(calls[0].body.model, 'text-embedding-3-small');
    assert.equal(calls[0].body.dimensions, 1536);
    assert.equal(calls[0].headers.authorization, 'Bearer k');
  });

  it('splits big requests into batches of 96', async () => {
    const { f, calls } = fakeFetch((b) => ({ status: 200, json: okBody(b.input.length) }));
    const out = await new OpenAiEmbedder({ apiKey: 'k', fetch: f }).embed(Array.from({ length: 200 }, (_, i) => `t${i}`));
    assert.equal(out.length, 200);
    assert.deepEqual(calls.map((c) => c.body.input.length), [96, 96, 8]);
  });

  it('retries a rate limit, but gives up immediately on a rejected request', async () => {
    const a = fakeFetch((b, n) => (n === 1 ? { status: 429 } : { status: 200, json: okBody(b.input.length) }));
    assert.equal((await new OpenAiEmbedder({ apiKey: 'k', fetch: a.f }).embed(['x'])).length, 1);
    assert.equal(a.calls.length, 2);

    const b = fakeFetch(() => ({ status: 401 }));
    await assert.rejects(new OpenAiEmbedder({ apiKey: 'k', fetch: b.f }).embed(['x']), (e: any) => e instanceof EmbeddingError && !e.retryable);
    assert.equal(b.calls.length, 1);
  });

  it('refuses vectors of the wrong size (they would not fit the vector(1536) column)', async () => {
    const { f } = fakeFetch(() => ({ status: 200, json: { data: [{ index: 0, embedding: vec(0, 768) }] } }));
    await assert.rejects(new OpenAiEmbedder({ apiKey: 'k', fetch: f }).embed(['x']), /1536/);
  });

  it('truncates absurdly long inputs and survives empty strings', async () => {
    const { f, calls } = fakeFetch((b) => ({ status: 200, json: okBody(b.input.length) }));
    await new OpenAiEmbedder({ apiKey: 'k', fetch: f }).embed(['y'.repeat(100_000), '']);
    assert.equal(calls[0].body.input[0].length, 20_000);
    assert.equal(calls[0].body.input[1], ' ');
  });

  it('needs an API key', () => assert.throws(() => new OpenAiEmbedder({ apiKey: '' }), /apiKey/));
});

describe('toPgVector', () => {
  it('formats pgvector text and rejects non-finite numbers', () => {
    assert.equal(toPgVector([0.5, -1, 2]), '[0.5,-1,2]');
    assert.throws(() => toPgVector([1, NaN]), EmbeddingError);
    assert.throws(() => toPgVector([Infinity]), EmbeddingError);
  });
});
