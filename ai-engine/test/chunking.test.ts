import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildBookmarkChunks, chunkText, MAX_CHUNKS_PER_BOOKMARK } from '../src/chunking.ts';

describe('chunkText', () => {
  it('returns nothing for empty text and one chunk for short text', () => {
    assert.deepEqual(chunkText('   \n\n '), []);
    assert.deepEqual(chunkText('A short note.'), ['A short note.']);
  });

  it('keeps every chunk within the limit and loses no paragraph', () => {
    const paragraphs = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} ` + 'lorem ipsum dolor sit amet '.repeat(15));
    const chunks = chunkText(paragraphs.join('\n\n'), { maxChars: 1000, overlapChars: 150 });
    assert.ok(chunks.length > 5);
    assert.ok(chunks.every((c) => c.length <= 1000), 'a chunk is over the limit');
    for (let i = 0; i < 40; i++) assert.ok(chunks.some((c) => c.includes(`Paragraph ${i} `)), `paragraph ${i} was lost`);
  });

  it('repeats a little context at the start of the next chunk', () => {
    const text = Array.from({ length: 12 }, (_, i) => `Section${i} ` + 'word '.repeat(80)).join('\n\n');
    const chunks = chunkText(text, { maxChars: 900, overlapChars: 120 });
    const tail = chunks[0]!.slice(-60).trim().split(' ').slice(-3).join(' ');
    assert.ok(chunks[1]!.includes(tail), 'no overlap between chunk 0 and 1');
  });

  it('splits long paragraphs on sentences, and unbroken text by length', () => {
    const sentences = Array.from({ length: 60 }, (_, i) => `This is sentence number ${i}.`).join(' ');
    const a = chunkText(sentences, { maxChars: 300, overlapChars: 40 });
    assert.ok(a.every((c) => c.length <= 300));
    const b = chunkText('x'.repeat(5000), { maxChars: 1600 });
    assert.ok(b.every((c) => c.length <= 1600) && b.length >= 3);
  });

  it('merges a tiny last piece into the previous chunk', () => {
    const text = `${'a '.repeat(700)}\n\n${'b '.repeat(10)}`;
    const chunks = chunkText(text, { maxChars: 1500, minChars: 200 });
    assert.equal(chunks.length, 1);
  });
});

describe('buildBookmarkChunks', () => {
  const b = { title: 'React UI libraries', url: 'https://www.instagram.com/reel/abc', platform: 'instagram', tags: ['react', 'ui-components'], summary: 'Seven libraries compared.', note: 'for the dashboard rebuild', contentText: 'shadcn/ui and MUI are compared.' };

  it('makes chunk 0 a header that mentions the platform, tags and the user\'s own note', () => {
    const [header, body] = buildBookmarkChunks(b);
    for (const s of ['React UI libraries', 'Saved from instagram', 'Tags: react, ui-components', 'Seven libraries compared.', 'My note: for the dashboard rebuild']) assert.ok(header!.includes(s), s);
    assert.equal(body, 'shadcn/ui and MUI are compared.');
  });

  it('copes with missing fields and caps the number of chunks', () => {
    assert.deepEqual(buildBookmarkChunks({ title: null, url: null, platform: null, tags: [], summary: null, note: null, contentText: null }), []);
    const huge = buildBookmarkChunks({ ...b, contentText: Array.from({ length: 400 }, (_, i) => `Paragraph ${i} ${'x'.repeat(1500)}`).join('\n\n') });
    assert.equal(huge.length, MAX_CHUNKS_PER_BOOKMARK);
  });
});
