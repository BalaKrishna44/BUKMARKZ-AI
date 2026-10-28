import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleIngest, mergeNote, parseIngest, type DbItem, type IngestDeps } from '../web/ingest';

const JWT = 'h'.repeat(10) + '.' + 'p'.repeat(40) + '.' + 's'.repeat(10);
function deps(o: { user?: { id: string; email: string } | null; rows?: Map<string, DbItem & { urlKey: string }> } = {}) {
  const rows = o.rows ?? new Map(); const calls: string[] = [];
  const d: IngestDeps = {
    getUser: async (t) => { calls.push('getUser'); return t === JWT ? (o.user === undefined ? { id: 'u1', email: 'a@x.com' } : o.user) : null; },
    find: async (uid, key) => { calls.push(`find:${uid}:${key}`); return rows.get(`${uid}|${key}`) ?? null; },
    insert: async (row) => { const id = `id${rows.size + 1}`; rows.set(`${row.user_id}|${row.url_key}`, { id, note: row.note, tags: row.tags, urlKey: row.url_key }); calls.push(`insert:${row.source}`); return id; },
    update: async (id, p) => { calls.push('update'); for (const r of rows.values()) if (r.id === id) Object.assign(r, p); },
  };
  return { d, rows, calls };
}
const post = (d: IngestDeps, body: object, auth: string | null = `Bearer ${JWT}`) => handleIngest(d, auth, 'POST', JSON.stringify(body));

test('GET verifies a token and returns the user; bad/missing tokens are 401 and touch nothing else', async () => {
  const { d, calls } = deps();
  assert.deepEqual(await handleIngest(d, `Bearer ${JWT}`, 'GET'), { status: 200, body: { user: { id: 'u1', email: 'a@x.com' } } });
  for (const auth of [null, '', 'Bearer', `Token ${JWT}`, 'Bearer short', `Bearer ${JWT}x`]) assert.equal((await handleIngest(d, auth, 'GET')).status, 401, String(auth));
  assert.ok(!calls.some((c) => c.startsWith('find') || c.startsWith('insert')));
});
test('page save inserts once, with the owner from the VERIFIED token, never from the body', async () => {
  const { d, rows, calls } = deps();
  const r = await post(d, { kind: 'page', url: 'https://a.com/x?utm_source=z#f', title: 'T', user_id: 'attacker', tags: ['AI'] });
  assert.deepEqual([r.status, r.body.created], [201, true]);
  assert.ok(rows.has('u1|a.com/x') && !JSON.stringify([...rows.keys()]).includes('attacker'));
  assert.ok(calls.includes('insert:extension:page'));
  const again = await post(d, { kind: 'page', url: 'https://www.a.com/x', title: 'T' });
  assert.deepEqual([again.status, again.body.created, rows.size], [200, false, 1]);       // same page, different spelling
});
test('selection becomes a note on the page; a replay does not duplicate it; a second selection appends', async () => {
  const { d, rows } = deps();
  await post(d, { kind: 'page', url: 'https://a.com/x', title: 'T' });
  await post(d, { kind: 'selection', url: 'https://a.com/x', note: '> one' });
  await post(d, { kind: 'selection', url: 'https://a.com/x', note: '> one' });             // queue replay
  await post(d, { kind: 'selection', url: 'https://a.com/x', note: '> two' });
  const row = rows.get('u1|a.com/x')!; assert.equal(row.note, '> one\n\n> two'); assert.deepEqual(row.tags, ['note']);
});
test('image: needs an http(s) image URL, is tagged, and says nothing about OCR', async () => {
  const { d, rows } = deps();
  const r = await post(d, { kind: 'image', url: 'https://a.com/p', imageUrl: 'https://c.test/i.png', note: '![image](https://c.test/i.png)' });
  assert.equal(r.status, 201); assert.deepEqual(rows.get('u1|a.com/p')!.tags, ['image']); assert.ok(!('ocr' in r.body));
  for (const imageUrl of [undefined, 'data:image/png;base64,AA', 'javascript:alert(1)']) assert.equal((await post(d, { kind: 'image', url: 'https://a.com/q', imageUrl })).status, 400);
});
test('bad input is 400: unknown kind, unsafe url, junk, oversized body', async () => {
  const { d } = deps();
  for (const b of [{ kind: 'x', url: 'https://a.com' }, { kind: 'page', url: 'javascript:alert(1)' }, { kind: 'page', url: 'ftp://a.com' }, { kind: 'page' }, null])
    assert.equal((await post(d, b as any)).status, 400, JSON.stringify(b));
  assert.equal((await handleIngest(d, `Bearer ${JWT}`, 'POST', '{not json')).status, 400);
  assert.equal((await handleIngest(d, `Bearer ${JWT}`, 'POST', JSON.stringify({ kind: 'page', url: 'https://a.com', note: 'x'.repeat(70_000) }))).status, 400);
});
test('parseIngest clamps lengths and cleans tags', () => {
  const p = parseIngest(JSON.stringify({ kind: 'page', url: 'https://a.com', title: 'T'.repeat(900), note: 'n'.repeat(20_000), tags: ['#Big Data', 5, 'big-data'] }));
  assert.ok(p.ok && p.value.title.length === 500 && p.value.note!.length === 10_000 && p.value.tags.join() === 'big-data');
  assert.equal(mergeNote(null, 'a'), 'a'); assert.equal(mergeNote('a', null), 'a');
});
