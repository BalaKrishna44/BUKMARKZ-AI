import {
  ArchiveError, classifyFetchError, codeLanguage, countWords, decodeHtml, fenceFor, fileWithFrontMatter, isHtmlType,
  readingMinutes, storageKey, tidyMarkdown, MAX_MD_CHARS,
} from '../lib/archive/pure';
import { archiveItem, runQueue, type ArchiveDeps, type ItemRow } from '../lib/archive/archiver';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('ok  ', m); } else { fail++; console.error('FAIL', m); } };
const rejects = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as ArchiveError; } };

// ── pure helpers
ok(readingMinutes('word '.repeat(440)) === 2, 'reading time: 440 words = 2 min');
ok(readingMinutes('hi') === 1, 'reading time never below 1');
const code = '```js\n' + 'x();\n'.repeat(59) + '```';
ok(countWords(code + '\nhello world').words === 2, 'fenced code is excluded from the word count');
ok(readingMinutes('word '.repeat(220) + '\n' + code) === 3, 'code lines add reading time (1 + ceil(61/60) = ... 2 extra min bound)'.replace(/ .*/, ' adds reading time'));
ok(countWords('日本語のテキストです').cjk >= 8, 'CJK characters counted separately');
ok(readingMinutes('字'.repeat(900)) === 2, 'CJK reading speed');
ok(isHtmlType('text/html; charset=utf-8') && isHtmlType('application/xhtml+xml') && !isHtmlType('application/pdf') && !isHtmlType(null), 'content-type check');

const t = tidyMarkdown('a\u0000b​\r\n\r\n\r\n\r\nc   \n');
ok(t.text === 'ab\n\nc' && !t.truncated, 'NUL and zero-width chars removed, blank lines collapsed');
const big = tidyMarkdown(('para text here.\n\n').repeat(40000));
ok(big.truncated && big.text.length <= MAX_MD_CHARS + 80, 'oversized markdown truncated');
const open = tidyMarkdown('intro\n\n```\n' + 'line\n'.repeat(60000), 1000);
ok(((open.text.match(/^```/gm) ?? []).length % 2) === 0, 'truncation never leaves a code fence open');

ok(fenceFor('plain') === '```' && fenceFor('has ``` inside') === '````' && fenceFor('a `` b') === '```', 'fence longer than any backtick run');
ok(codeLanguage('language-typescript') === 'typescript' && codeLanguage('highlight-source-python') === 'python' && codeLanguage('lang-c++') === 'c++', 'code language from class names');
ok(codeLanguage('nohighlight') === '' && codeLanguage(null, undefined) === '' && codeLanguage('language-text') === '', 'no language when none/plain');
ok(codeLanguage('foo bar', 'rust') === 'rust', 'data-lang style bare value');

const latin = new Uint8Array([0x63, 0x61, 0x66, 0xe9]);      // "café" in latin-1
ok(decodeHtml(latin, 'text/html; charset=iso-8859-1') === 'café', 'decodes charset from header');
ok(decodeHtml(new TextEncoder().encode('<meta charset="utf-8">é'), 'text/html').endsWith('é'), 'decodes charset from meta / default');
ok(decodeHtml(new TextEncoder().encode('ok'), 'text/html; charset=bogus-label') === 'ok', 'unknown charset falls back to UTF-8');

const fm = fileWithFrontMatter('Body', { title: 'A "quoted"\ntitle', url: 'https://e.com/x', archivedAt: new Date('2026-01-02T03:04:05Z'), site: 'E', words: 10 });
ok(fm.startsWith('---\ntitle: "A \\"quoted\\" title"\n') && fm.includes('archived: 2026-01-02T03:04:05.000Z') && fm.endsWith('---\n\nBody\n'), 'front matter is escaped and well-formed');
ok(storageKey('u1', 'i1') === 'u1/i1.md', 'storage key is <user>/<item>.md');

ok(classifyFetchError(new Error('Blocked address 10.0.0.1')).code === 'blocked_address', 'classify: blocked');
ok(classifyFetchError(new Error('response too large')).code === 'too_large', 'classify: too large');
ok(classifyFetchError(Object.assign(new Error('x'), { name: 'TimeoutError' })).code === 'timeout', 'classify: timeout');
ok(classifyFetchError(new Error('ECONNRESET secret-host.internal')).code === 'network' && !classifyFetchError(new Error('ECONNRESET secret-host.internal')).message.includes('secret'), 'classify: unknown -> network, no raw text kept');

// ── worker flow with fakes
const ROW: ItemRow = { id: 'i1', user_id: 'u1', url: 'https://example.com/a', archive_hash: null, archive_attempts: 0 };
const article = '# T\n\n' + 'This is a readable sentence about archiving. '.repeat(20);
function mk(over: Partial<ArchiveDeps> = {}) {
  const log = { uploads: [] as [string, string][], done: [] as any[], failed: [] as [string, string][] };
  const deps: ArchiveDeps = {
    now: () => new Date('2026-01-01T00:00:00Z'),
    claim: async () => ({ ...ROW }),
    fetchPage: async () => ({ html: '<html/>', finalUrl: 'https://example.com/final' }),
    extract: async () => ({ title: 'T', byline: 'Ann', siteName: 'Ex', lang: 'en', markdown: article }),
    upload: async (p, b) => { log.uploads.push([p, b]); },
    saveDone: async (_r, r) => { log.done.push(r); },
    saveFailed: async (_r, c) => { log.failed.push([_r.id, c]); },
    ...over,
  };
  return { deps, log };
}

(async () => {
  { const { deps, log } = mk(); const r = await archiveItem('i1', 'u1', deps);
    ok(r.status === 'done' && r.path === 'u1/i1.md' && r.words > 100 && r.minutes >= 1, 'happy path returns stats');
    ok(log.uploads.length === 1 && log.uploads[0][1].includes('source: "https://example.com/final"') && log.uploads[0][1].includes('author: "Ann"'), 'file has front matter with final URL');
    ok(log.done.length === 1 && log.done[0].markdown.startsWith('# T') && /^[0-9a-f]{64}$/.test(log.done[0].hash), 'db save carries markdown and sha256'); }
  { const { deps } = mk({ claim: async () => null }); const e = await rejects(archiveItem('i1', 'u1', deps)); ok(e?.code === 'db_error', 'unclaimable item -> error, nothing else runs'); }
  { const { deps, log } = mk({ fetchPage: async () => { throw new ArchiveError('http_error'); } }); const e = await rejects(archiveItem('i1', 'u1', deps));
    ok(e?.code === 'http_error' && log.failed[0][1] === 'http_error' && log.uploads.length === 0, 'fetch failure stored as short code, no upload'); }
  { const { deps, log } = mk({ extract: async () => ({ title: 'x', byline: null, siteName: null, lang: null, markdown: 'Please log in to continue.' }) }); const e = await rejects(archiveItem('i1', 'u1', deps));
    ok(e?.code === 'no_readable_content' && log.done.length === 0, 'login-wall / empty page rejected'); }
  { const { deps, log } = mk({ extract: async () => { throw new TypeError('jsdom exploded with <secret>'); } }); const e = await rejects(archiveItem('i1', 'u1', deps));
    ok(e?.code === 'parse_failed' && !e.message.includes('secret') && log.failed[0][1] === 'parse_failed', 'extractor crash -> parse_failed, message not stored'); }
  { const { deps, log } = mk({ upload: async () => { throw new Error('bucket missing'); } }); const e = await rejects(archiveItem('i1', 'u1', deps));
    ok(e?.code === 'storage_failed' && log.done.length === 0, 'storage failure does not mark done'); }
  { const { deps, log } = mk({ saveDone: async () => { throw new Error('rls'); } }); const e = await rejects(archiveItem('i1', 'u1', deps));
    ok(e?.code === 'db_error' && log.failed[0][1] === 'db_error', 'db failure after upload recorded as failed'); }
  { const { deps } = mk({ saveFailed: async () => { throw new Error('db down'); }, fetchPage: async () => { throw new Error('timeout'); } }); const e = await rejects(archiveItem('i1', 'u1', deps));
    ok(e?.code === 'timeout', 'original error survives a failing saveFailed'); }
  { const first = mk(); const r1 = await archiveItem('i1', 'u1', first.deps); const h = first.log.done[0].hash;
    const again = mk({ claim: async () => ({ ...ROW, archive_hash: h }) }); const r2 = await archiveItem('i1', 'u1', again.deps);
    ok(r1.status === 'done' && r2.status === 'unchanged', 're-archiving identical content reports unchanged'); }
  { const seen: string[] = []; const { deps } = mk({ claim: async (id) => { seen.push(id); if (id === 'bad') return null; return { ...ROW, id }; } });
    const r = await runQueue([{ id: 'a', user_id: 'u1' }, { id: 'bad', user_id: 'u1' }, { id: 'b', user_id: 'u1' }], deps);
    ok(r.done === 2 && r.failed === 1 && r.skipped === 0 && seen.join() === 'a,bad,b', 'queue continues past a failing item'); }
  { const { deps } = mk(); const r = await runQueue([{ id: 'a', user_id: 'u1' }, { id: 'b', user_id: 'u1' }], deps, -1);
    ok(r.skipped === 2 && r.done === 0, 'queue stops when the time budget is spent'); }

  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
