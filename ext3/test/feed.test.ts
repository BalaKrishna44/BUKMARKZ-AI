import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALL, filterFeed, groupByCategory, parseFeedRows, timeAgo, UNCATEGORIZED } from '../src/lib/feed';
import { sanitizeSave } from '../src/shared/validate';

const row = (o: Record<string, unknown> = {}) => ({ id: 'a', title: 'T', url: 'https://x.com/p', favicon_url: 'https://x.com/f.ico', ai_category: 'AI & ML', summary_tldr: 'sum', created_at: '2026-10-20T10:00:00Z', ...o });

test('parseFeedRows keeps good rows and drops hostile / malformed ones', () => {
  const out = parseFeedRows([row(), row({ id: 'b', url: 'javascript:alert(1)' }), row({ id: 'c', favicon_url: 'data:image/png;base64,AAAA' }), { id: 5 }, null, row({ id: 'd', title: '', ai_category: '  ' })]);
  assert.deepEqual(out.map((r) => r.id), ['a', 'c', 'd']);
  assert.equal(out[1].favicon_url, null);                          // data: favicon refused
  assert.equal(out[2].title, 'x.com'); assert.equal(out[2].ai_category, null);
  assert.deepEqual(parseFeedRows({ not: 'an array' }), []);
});
test('groupByCategory: biggest first, Uncategorized last, no mutation of input order inside groups', () => {
  const items = parseFeedRows([row({ id: '1', ai_category: 'Finance' }), row({ id: '2', ai_category: null }), row({ id: '3', ai_category: 'Development' }), row({ id: '4', ai_category: 'Development' }), row({ id: '5', ai_category: 'Finance' }), row({ id: '6', ai_category: 'Reading List' })]);
  const g = groupByCategory(items);
  assert.deepEqual(g.map((x) => x.name), ['Development', 'Finance', 'Reading List', UNCATEGORIZED]);
  assert.deepEqual(g[0].items.map((i) => i.id), ['3', '4']);
});
test('filterFeed: category tab + every search term must match title, host, summary or category', () => {
  const items = parseFeedRows([row({ id: '1', title: 'Postgres RLS guide', ai_category: 'Development', summary_tldr: 'row level security' }), row({ id: '2', title: 'Index funds', ai_category: 'Finance', url: 'https://invest.com/a' }), row({ id: '3', title: 'Loose note', ai_category: null })]);
  assert.deepEqual(filterFeed(items, '', ALL).length, 3);
  assert.deepEqual(filterFeed(items, 'security rls', ALL).map((i) => i.id), ['1']);
  assert.deepEqual(filterFeed(items, 'invest', ALL).map((i) => i.id), ['2']);               // host match
  assert.deepEqual(filterFeed(items, '', UNCATEGORIZED).map((i) => i.id), ['3']);
  assert.deepEqual(filterFeed(items, 'rls', 'Finance'), []);
});
test('timeAgo', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');
  assert.deepEqual(['2026-10-21T11:59:40Z', '2026-10-21T11:15:00Z', '2026-10-21T07:00:00Z', '2026-10-18T12:00:00Z'].map((d) => timeAgo(d, now)), ['just now', '45m ago', '5h ago', '3d ago']);
});
test('sanitizeSave carries favicon (http/https only) and a trimmed description', () => {
  const base = { url: 'https://a.com/x', title: 'T', note: '', tags: [], remindAt: null, private: false };
  const ok = sanitizeSave({ ...base, favicon: 'https://a.com/f.png', description: '  hello \n world ' })!;
  assert.deepEqual([ok.favicon, ok.description], ['https://a.com/f.png', 'hello world']);
  const bad = sanitizeSave({ ...base, favicon: 'data:image/svg+xml,<svg onload=x>', description: 'x'.repeat(1000) })!;
  assert.equal(bad.favicon, undefined); assert.equal(bad.description!.length, 300);
});
