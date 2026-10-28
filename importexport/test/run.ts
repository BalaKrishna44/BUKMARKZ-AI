import assert from 'node:assert/strict';
import { BookmarkParser, parseNetscapeHtml } from '../lib/import/parser';
import { checkUrl, toIsoDate } from '../lib/import/normalize';
import { netscapeHtml, jsonHeader, jsonItem, collectionPaths, type ExportItem } from '../lib/export/serialize';

let n = 0; const t = (name: string, fn: () => void) => { fn(); n++; console.log('ok', name); };
const P = new BookmarkParser();

const CHROME = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8"><TITLE>Bookmarks</TITLE><H1>Bookmarks</H1>
<DL><p>
  <DT><H3 ADD_DATE="1600000000" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
  <DL><p>
    <DT><H3>Dev &amp; Ops</H3>
    <DL><p>
      <DT><A HREF="https://www.Example.com/a/?utm_source=x&amp;id=2#frag" ADD_DATE="1650000000" TAGS="React, Next JS">Tom &amp; Jerry &lt;b&gt;</A>
      <DD>a note
second line
    </DL><p>
    <DT><A HREF="https://example.com/root">Root link</A>
  </DL><p>
  <DT><A HREF="javascript:alert(1)">bookmarklet</A>
  <DT><A HREF="place:sort=8">place</A>
  <DT><A HREF="https://user:pw@example.com/">creds</A>
  <DT><A HREF="ftp://x.com/">ftp</A>
</DL><p>`;

t('chrome html: folders, entities, tags, dates, notes, skips', () => {
  const r = P.parse(CHROME, 'bookmarks.html');
  assert.equal(r.format, 'netscape-html');
  assert.equal(r.items.length, 2);
  const [a, b] = r.items;
  assert.deepEqual(a.folder, ['Bookmarks bar', 'Dev & Ops']);
  assert.equal(a.title, 'Tom & Jerry <b>');
  assert.deepEqual(a.tags, ['react', 'next-js']);
  assert.equal(a.createdAt, new Date(1650000000 * 1000).toISOString());
  assert.equal(a.note, 'a note\nsecond line');
  assert.equal(a.urlKey, 'example.com/a?id=2');
  assert.deepEqual(b.folder, ['Bookmarks bar']);
  assert.equal(b.note, null);
  const sk = Object.fromEntries(r.skipped.map((s) => [s.reason, s.count]));
  assert.deepEqual(sk, { 'unsupported-scheme': 3, 'credentials-in-url': 1 });
});

t('pocket flat html with time_added + tags attr', () => {
  const r = P.parse(`<!DOCTYPE html><html><body><h1>Unread</h1><ul>
  <li><a href="https://a.com/x" time_added="1700000000" tags="rust,cli">A</a></li>
  <li><a href="https://b.com/" time_added="1700000001" tags="">B</a></li></ul></body></html>`, 'ril_export.html');
  assert.equal(r.sourceGuess, 'Pocket'); assert.equal(r.items.length, 2);
  assert.deepEqual(r.items[0].tags, ['rust', 'cli']); assert.deepEqual(r.items[0].folder, []);
});

t('raindrop csv: quotes, newline in field, comma tags', () => {
  const csv = 'id,title,note,excerpt,url,folder,tags,created,cover,highlights,favorite\r\n' +
    '1,"He said ""hi""","line1\nline2",ex,https://r.com/1,Reading,"a, b",2023-05-01T10:00:00.000Z,,,false\r\n' +
    '2,No url,,,,Reading,,,,,\r\n3,Ok,,,https://r.com/3,,,,,,\r\n';
  const r = P.parse(csv, 'raindrop.csv');
  assert.equal(r.sourceGuess, 'Raindrop.io'); assert.equal(r.items.length, 2);
  assert.equal(r.items[0].title, 'He said "hi"'); assert.equal(r.items[0].note, 'line1\nline2');
  assert.deepEqual(r.items[0].tags, ['a', 'b']); assert.deepEqual(r.items[0].folder, ['Reading']);
  assert.equal(r.items[0].createdAt, '2023-05-01T10:00:00.000Z');
  assert.deepEqual(r.skipped, [{ reason: 'missing-url', count: 1 }]);
});

t('pocket csv pipes + instapaper csv', () => {
  const p = P.parse('title,url,time_added,tags,status\nT,https://p.com/,1700000000,a|b,unread\n', 'p.csv');
  assert.deepEqual(p.items[0].tags, ['a', 'b']);
  const i = P.parse('URL,Title,Selection,Folder,Timestamp\nhttps://i.com/,I,quote,Starred,1700000000\n', 'i.csv');
  assert.equal(i.items[0].note, 'quote'); assert.deepEqual(i.items[0].folder, ['Starred']);
});

t('pinboard json (space tags, description=title, extended=note)', () => {
  const r = P.parse(JSON.stringify([{ href: 'https://pb.com/', description: 'PB', extended: 'why', tags: 'x y  z', time: '2022-01-02T03:04:05Z', toread: 'no' }]));
  assert.equal(r.sourceGuess, 'Pinboard');
  assert.equal(r.items[0].title, 'PB'); assert.equal(r.items[0].note, 'why'); assert.deepEqual(r.items[0].tags, ['x', 'y', 'z']);
});

t('bad input does not throw', () => {
  for (const s of ['', '   ', 'hello', '{', '[1,2,null]', '<html></html>', 'a,b\n1,2']) {
    const r = P.parse(s); assert.equal(r.items.length, 0);
  }
});

t('maxItems cap', () => {
  const html = '<DL>' + Array.from({ length: 10 }, (_, i) => `<DT><A HREF="https://x.com/${i}">${i}</A>`).join('') + '</DL>';
  const r = new BookmarkParser({ maxItems: 3 }).parse(html);
  assert.equal(r.items.length, 3); assert.deepEqual(r.skipped, [{ reason: 'over-limit', count: 7 }]);
});

t('url + date helpers', () => {
  assert.equal(checkUrl('HTTPS://Www.X.com:443/p/').ok, true);
  assert.equal((checkUrl('https://x.com/') as any).key, 'x.com');
  assert.equal(toIsoDate('0'), null); assert.equal(toIsoDate('garbage'), null);
  assert.equal(toIsoDate(1700000000), toIsoDate(1700000000000)); assert.equal(toIsoDate(1700000000), toIsoDate(1700000000000000));
});

t('perf: 20k bookmarks parse < 2s', () => {
  const html = '<DL>' + Array.from({ length: 20000 }, (_, i) => `<DT><A HREF="https://x.com/${i}" ADD_DATE="1700000000">T${i}</A>`).join('\n') + '</DL>';
  const s = Date.now(); const r = P.parse(html); const ms = Date.now() - s;
  assert.equal(r.items.length, 20000); assert.ok(ms < 2000, `${ms}ms`); console.log('   ', ms, 'ms');
});

t('export → import round-trip (HTML + JSON), hostile strings escaped', () => {
  const cols = [{ id: 'c1', parent_id: null, name: 'Dev "&" <x>' }, { id: 'c2', parent_id: 'c1', name: 'React' }];
  const mk = (o: Partial<ExportItem>): ExportItem => ({ url: 'https://a.com/', title: 't', note: null, tags: [], collection_id: null, status: 'bookmark', category: null, summary: null, action_items: [], remind_at: null, created_at: '2024-01-01T00:00:00.000Z', ...o });
  const items = [mk({ url: 'https://a.com/1?x=1&y=2', title: '<script>alert(1)</script>', note: 'n & "q"', tags: ['a', 'b-c'], collection_id: 'c2' }), mk({ url: 'https://a.com/2', collection_id: 'c1', summary: 'sum' }), mk({ url: 'https://a.com/3' })];
  const html = [...netscapeHtml(cols, items)].join('');
  assert.ok(!html.includes('<script>'));
  const r = P.parse(html);
  assert.equal(r.items.length, 3);
  const by = Object.fromEntries(r.items.map((i) => [i.url, i]));
  assert.deepEqual(by['https://a.com/1?x=1&y=2'].folder, ['Dev "&" <x>', 'React']);
  assert.equal(by['https://a.com/1?x=1&y=2'].title, '<script>alert(1)</script>');
  assert.equal(by['https://a.com/1?x=1&y=2'].note, 'n & "q"');
  assert.deepEqual(by['https://a.com/1?x=1&y=2'].tags, ['a', 'b-c']);
  assert.deepEqual(by['https://a.com/3'].folder, []);
  assert.equal(by['https://a.com/2'].note, null);
  const paths = collectionPaths(cols);
  const json = jsonHeader() + items.map((i) => jsonItem(i, paths)).join(',') + ']}';
  const j = P.parse(json);
  assert.equal(j.sourceGuess, 'Bukmarkz'); assert.equal(j.items.length, 3);
  assert.deepEqual(j.items.find((i) => i.url.endsWith('/1?x=1&y=2'))!.folder, ['Dev "&" <x>', 'React']);
});

console.log(`\n${n} tests passed`);
