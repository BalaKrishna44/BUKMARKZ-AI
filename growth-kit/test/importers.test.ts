import test from 'node:test'; import assert from 'node:assert/strict';
import { parseBrowserHtml, parseRedditSaved, parseYoutubeWatchLater, parseReadwise, parseCsv, normalizeUrl, detectAndParse, MAX_ROWS } from '../lib/importers/extra';

const CHROME = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE><H1>Bookmarks</H1>
<DL><p>
  <DT><H3 ADD_DATE="1700000000">Bookmarks bar</H3>
  <DL><p>
    <DT><A HREF="https://example.com/a?utm_source=x&amp;id=2" ADD_DATE="1700000000" TAGS="db, sql">Postgres &amp; <b>RLS</b></A>
    <DT><H3>Dev</H3>
    <DL><p>
      <DT><A HREF="https://EXAMPLE.com/b/">=cmd|' /C calc'!A0</A>
      <DT><A HREF="javascript:alert(1)">bad</A>
      <DT><A HREF="https://user:pw@example.com/x">creds</A>
    </DL><p>
  </DL><p>
  <DT><A HREF="https://example.com/b#frag">dup of b</A>
</DL><p>`;

test('browser html: folders, entities, tracking params, dates, tags', () => {
  const r = parseBrowserHtml(CHROME);
  assert.equal(r.rows.length, 2);
  const a = r.rows[0];
  assert.equal(a.url, 'https://example.com/a?id=2');
  assert.equal(a.title, 'Postgres & RLS');
  assert.equal(a.folder, 'Bookmarks bar');
  assert.deepEqual(a.tags, ['db', 'sql']);
  assert.equal(a.savedAt, '2023-11-14T22:13:20.000Z');
  assert.equal(r.rows[1].folder, 'Bookmarks bar / Dev');
});
test('browser html: rejects javascript: and credentials, strips formula prefix, dedupes', () => {
  const r = parseBrowserHtml(CHROME);
  assert.equal(r.skipped, 2);
  assert.equal(r.duplicates, 1);
  assert.ok(!/^[=+\-@]/.test(r.rows[1].title));
});
test('browser html: empty file warns', () => {
  assert.match(parseBrowserHtml('<html></html>').warnings[0], /No bookmarks found/);
});
test('csv: quotes, commas, newlines, BOM, CRLF', () => {
  const t = parseCsv('﻿a,b\r\n"x, ""y""","line1\nline2"\r\n');
  assert.deepEqual(t, [['a', 'b'], ['x, "y"', 'line1\nline2']]);
});
test('reddit: relative permalinks become full URLs; bad rows skipped', () => {
  const r = parseRedditSaved('id,permalink\nabc,/r/postgres/comments/abc/how_to_tune_hnsw/\ndef,\nghi,javascript:alert(1)\n');
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].url, 'https://www.reddit.com/r/postgres/comments/abc/how_to_tune_hnsw/');
  assert.equal(r.rows[0].title, 'how to tune hnsw');
  assert.equal(r.skipped, 2);
});
test('youtube: only valid 11-char ids', () => {
  const r = parseYoutubeWatchLater('Video ID,Playlist video creation timestamp\ndQw4w9WgXcQ,2024-03-01T10:00:00+00:00\nshort,2024-03-01T10:00:00+00:00\n');
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(r.rows[0].savedAt, '2024-03-01T10:00:00.000Z');
  assert.equal(r.skipped, 1);
});
test('readwise: loose headers, tags, missing column message', () => {
  const r = parseReadwise('Title,URL,Tags,Saved Date\n"A, B",https://a.com/x,"ai;db",2024-01-02\n');
  assert.equal(r.rows[0].title, 'A, B'); assert.deepEqual(r.rows[0].tags, ['ai', 'db']);
  assert.match(parseReadwise('Highlight,Note\nx,y\n').warnings[0], /No URL column/);
});
test('detectAndParse routes by header', () => {
  assert.equal(detectAndParse('x.csv', 'Video ID,ts\ndQw4w9WgXcQ,2024-01-01\n')?.format, 'youtube_watch_later');
  assert.equal(detectAndParse('saved_posts.csv', 'id,permalink\na,/r/x/comments/1/y/\n')?.format, 'reddit');
  assert.equal(detectAndParse('b.html', CHROME)?.format, 'browser_html');
  assert.equal(detectAndParse('r.csv', 'Title,URL\na,https://a.com\n')?.format, 'readwise');
  assert.equal(detectAndParse('x.csv', 'foo,bar\n1,2\n'), null);
});
test('normalizeUrl', () => {
  assert.equal(normalizeUrl('ftp://a.com'), null);
  assert.equal(normalizeUrl('https://A.com/p?fbclid=1&q=2'), 'https://a.com/p?q=2');
  assert.equal(normalizeUrl('x'.repeat(3000)), null);
});
test('row cap', () => {
  const csv = 'Title,URL\n' + Array.from({ length: MAX_ROWS + 5 }, (_, i) => `t${i},https://a.com/${i}`).join('\n');
  const r = parseReadwise(csv);
  assert.equal(r.rows.length, MAX_ROWS); assert.equal(r.truncated, true);
});
