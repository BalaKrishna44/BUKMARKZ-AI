import test from 'node:test';
import assert from 'node:assert/strict';
import { applyChange, normalizeTag, parseTagInput, rowFromPayload, splitTags, toBookmark, type ItemRow } from '../lib/bookmarks';
import { safeNext } from '../lib/safeNext';

const row = (o: Partial<ItemRow> = {}): ItemRow => ({ id: 'a', title: 'T', url: 'https://x.com/a', note: null, tags: [], ai_tags: [], summary: null, meta_description: null, favicon_url: null, category_id: null, created_at: '2026-01-02T00:00:00Z', item_type: 'link', completed_at: null, ...o });
const bm = (o: Partial<ItemRow>) => toBookmark(row(o))!;

test('normalizeTag / parseTagInput', () => {
  assert.equal(normalizeTag('#Next JS'), 'next-js'); assert.equal(normalizeTag('  ##AI & ML! '), 'ai-ml'); assert.equal(normalizeTag('日本語'), '日本語'); assert.equal(normalizeTag('!!!'), null); assert.equal(normalizeTag(''), null);
  assert.equal(normalizeTag('x'.repeat(100))!.length, 30);
  assert.deepEqual(parseTagInput('react, #Next  rag,,react'), ['react', 'next', 'rag']);
  assert.equal(parseTagInput(Array.from({ length: 40 }, (_, i) => 't' + i).join(' ')).length, 20);
  assert.deepEqual(parseTagInput("'; drop table x;--"), ['drop', 'table', 'x']);
});
test('splitTags keeps AI tags in ai_tags and puts new ones in tags', () => {
  const b = bm({ ai_tags: ['react', 'rag'], tags: ['mine'] });
  assert.deepEqual(splitTags(b, ['react', 'mine', 'New One', '#react']), { ai_tags: ['react'], tags: ['mine', 'new-one'] });   // rag removed, dupes merged
  assert.deepEqual(splitTags(b, []), { ai_tags: [], tags: [] });
});
test('toBookmark: tasks, tags, unsafe urls', () => {
  const t = bm({ item_type: 'oneclist_task', completed_at: '2026-01-03T00:00:00Z', ai_tags: ['a'], tags: ['b', 'a'] });
  assert.equal(t.isTask, true); assert.equal(t.completedAt, '2026-01-03T00:00:00Z'); assert.deepEqual(t.tags, ['a', 'b']);
  assert.equal(toBookmark(row({ url: 'javascript:alert(1)' })), null);
});
test('rowFromPayload rejects junk and coerces bad column types to null', () => {
  assert.equal(rowFromPayload(null), null); assert.equal(rowFromPayload({ id: 1, url: 'https://x.com', created_at: 'x' }), null); assert.equal(rowFromPayload('str'), null);
  const r = rowFromPayload({ id: 'a', url: 'https://x.com', created_at: 'c', title: 5, tags: 'oops', ai_tags: ['ok', 3], category_id: {}, extra: 'ignored' })!;
  assert.equal(r.title, null); assert.equal(r.tags, null); assert.deepEqual(r.ai_tags, ['ok']); assert.equal(r.category_id, null); assert.ok(!('extra' in r));
});
test('applyChange: insert newest-first, idempotent update, delete, unsafe url removes', () => {
  const a = bm({ id: 'a', created_at: '2026-01-01T00:00:00Z' }), c = bm({ id: 'c', created_at: '2026-01-03T00:00:00Z' });
  let list = [c, a];
  list = applyChange(list, { kind: 'upsert', row: row({ id: 'b', created_at: '2026-01-02T00:00:00Z' }) }); assert.deepEqual(list.map((x) => x.id), ['c', 'b', 'a']);
  list = applyChange(list, { kind: 'upsert', row: row({ id: 'z', created_at: '2026-02-01T00:00:00Z' }) }); assert.equal(list[0].id, 'z');
  list = applyChange(list, { kind: 'upsert', row: row({ id: 'old', created_at: '2020-01-01T00:00:00Z' }) }); assert.equal(list.at(-1)!.id, 'old');
  const before = list.length;
  const upd = applyChange(list, { kind: 'upsert', row: row({ id: 'b', title: 'Renamed', created_at: '2026-01-02T00:00:00Z' }) }); assert.equal(upd.length, before); assert.equal(upd.find((x) => x.id === 'b')!.title, 'Renamed');
  assert.equal(applyChange(upd, { kind: 'upsert', row: row({ id: 'b', title: 'Renamed', created_at: '2026-01-02T00:00:00Z' }) }).length, before);
  assert.equal(applyChange(upd, { kind: 'delete', id: 'nope' }), upd);                                                       // unknown id: same array, no re-render
  assert.ok(!applyChange(upd, { kind: 'delete', id: 'b' }).some((x) => x.id === 'b'));
  assert.ok(!applyChange(upd, { kind: 'upsert', row: row({ id: 'b', url: 'javascript:1' }) }).some((x) => x.id === 'b'));
  assert.equal(applyChange(upd, { kind: 'upsert', row: row({ id: 'new', url: 'javascript:1' }) }), upd);
});
test('safeNext only allows same-site paths', () => {
  for (const ok of ['/dashboard', '/dashboard?x=1#h', '/a/b']) assert.equal(safeNext(ok), ok);
  for (const bad of ['https://evil.test', '//evil.test', '/\\evil.test', 'javascript:alert(1)', 'dashboard', '', null, undefined, '/ok\n/evil', '/' + 'a'.repeat(600)]) assert.equal(safeNext(bad as string), '/dashboard', String(bad));
});
