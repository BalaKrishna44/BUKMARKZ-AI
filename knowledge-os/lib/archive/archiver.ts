// Webpage snapshot worker: URL -> clean Markdown -> Supabase Storage ('archives') + oneclist_items.full_markdown_content.
//
//   npm i jsdom @mozilla/readability turndown turndown-plugin-gfm
//   npm i -D @types/jsdom @types/turndown
//
// All heavy libraries are imported lazily inside defaultExtract(), and every side effect goes through `deps`,
// so the control flow is unit-testable without them (see test/archive.test.ts).
import {
  ArchiveError, MAX_HTML_BYTES, STALE_CLAIM_MS, classifyFetchError, codeLanguage, countWords, decodeHtml, fenceFor,
  fileWithFrontMatter, isHtmlType, readingMinutes, sha256, storageKey, tidyMarkdown,
} from './pure';

export interface Extracted { title: string; byline: string | null; siteName: string | null; lang: string | null; markdown: string }
export interface ArchiveResult { itemId: string; status: 'done' | 'unchanged'; words: number; minutes: number; truncated: boolean; path: string }

export interface ItemRow { id: string; user_id: string; url: string; archive_hash: string | null; archive_attempts: number }
export interface ArchiveDeps {
  claim(itemId: string, userId: string | null, now: Date): Promise<ItemRow | null>;      // atomic: null if someone else holds it / not eligible
  fetchPage(url: string): Promise<{ html: string; finalUrl: string }>;
  extract(html: string, url: string): Promise<Extracted>;
  upload(path: string, body: string): Promise<void>;
  saveDone(row: ItemRow, r: { path: string; hash: string; ex: Extracted; markdown: string; words: number; minutes: number; truncated: boolean; now: Date }): Promise<void>;
  saveFailed(row: ItemRow, code: string, now: Date): Promise<void>;
  now(): Date;
}

export const MAX_ATTEMPTS = 3;

export async function archiveItem(itemId: string, userId: string | null, deps: ArchiveDeps): Promise<ArchiveResult> {
  const now = deps.now();
  const row = await deps.claim(itemId, userId, now);
  if (!row) throw new ArchiveError('db_error', 'item not found or already being archived');
  try {
    const { html, finalUrl } = await deps.fetchPage(row.url);
    let ex: Extracted;
    try { ex = await deps.extract(html, finalUrl); } catch (e) { throw e instanceof ArchiveError ? e : new ArchiveError('parse_failed'); }
    const { text, truncated } = tidyMarkdown(ex.markdown);
    if (countWords(text).words + countWords(text).cjk < 25) throw new ArchiveError('no_readable_content');   // login walls, JS-only shells, paywalls
    const { words, cjk } = countWords(text);
    const minutes = readingMinutes(text);
    const path = storageKey(row.user_id, row.id);
    const hash = sha256(text);
    try { await deps.upload(path, fileWithFrontMatter(text, { title: ex.title, url: finalUrl, archivedAt: now, site: ex.siteName, byline: ex.byline, lang: ex.lang, words: words + cjk })); }
    catch { throw new ArchiveError('storage_failed'); }
    try { await deps.saveDone(row, { path, hash, ex, markdown: text, words: words + cjk, minutes, truncated, now }); }
    catch { throw new ArchiveError('db_error'); }
    return { itemId: row.id, status: row.archive_hash === hash ? 'unchanged' : 'done', words: words + cjk, minutes, truncated, path };
  } catch (e) {
    const err = classifyFetchError(e);
    await deps.saveFailed(row, err.code, deps.now()).catch(() => {});
    throw err;
  }
}

/** Run up to `limit` queued items sequentially (one JSDOM at a time keeps memory flat on serverless). Stops before `budgetMs`. */
export async function runQueue(
  ids: { id: string; user_id: string }[], deps: ArchiveDeps, budgetMs = 45_000,
): Promise<{ done: number; failed: number; skipped: number }> {
  const t0 = Date.now(); let done = 0, failed = 0, skipped = 0;
  for (const it of ids) {
    if (Date.now() - t0 > budgetMs) { skipped += 1; continue; }
    try { await archiveItem(it.id, it.user_id, deps); done += 1; } catch { failed += 1; }
  }
  return { done, failed, skipped };
}

// ───────────────────────── real implementations ─────────────────────────

export async function defaultFetchPage(url: string): Promise<{ html: string; finalUrl: string }> {
  let res;
  try {
    const { safeFetch } = await import('../ssrf');      // lazy: keeps the control flow importable (and testable) without undici
    res = await safeFetch(url, {
      maxBytes: MAX_HTML_BYTES, timeoutMs: 20_000, maxRedirects: 4,
      headers: { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1', 'user-agent': 'Mozilla/5.0 (compatible; BukmarkzArchiver/1.0; +https://bukmarkz.com/bot)' },
    });
  } catch (e) { throw classifyFetchError(e); }
  if (res.status < 200 || res.status >= 300) throw new ArchiveError('http_error', `HTTP ${res.status}`);
  if (!isHtmlType(res.headers.get('content-type'))) throw new ArchiveError('not_html');
  return { html: decodeHtml(res.body, res.headers.get('content-type')), finalUrl: res.url };
}

const absolute = (href: string | null | undefined, base: string): string | null => {
  if (!href) return null;
  try { const u = new URL(href, base); return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null; } catch { return null; }
};

export async function defaultExtract(html: string, url: string): Promise<Extracted> {
  const [{ JSDOM, VirtualConsole }, { Readability }, TurndownMod, gfm] = await Promise.all([
    import('jsdom'), import('@mozilla/readability'), import('turndown'), import('turndown-plugin-gfm'),
  ]);
  const Turndown = (TurndownMod as any).default ?? TurndownMod;

  // No runScripts, no resource loading: the page's JavaScript never executes and nothing is fetched by the DOM.
  // The empty VirtualConsole drops CSS-parse noise from hostile pages.
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  const doc = dom.window.document;
  try {
    const lang = doc.documentElement.getAttribute('lang')?.trim().slice(0, 12) || null;
    const meta = (sel: string) => doc.querySelector(sel)?.getAttribute('content')?.trim() || null;
    const siteName = meta('meta[property="og:site_name"]') ?? null;
    const article = new Readability(doc, { keepClasses: true, charThreshold: 200 }).parse();    // keepClasses: needed to detect code languages
    if (!article?.content) throw new ArchiveError('no_readable_content');

    const td = new Turndown({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*', linkStyle: 'inlined' });
    td.use(gfm.gfm);
    td.remove(['script', 'style', 'noscript', 'iframe', 'form', 'button', 'svg', 'canvas', 'template']);

    // <pre><code class="language-ts"> -> fenced block with language. The fence is longer than any backtick run inside.
    td.addRule('fencedCode', {
      filter: (n: any) => n.nodeName === 'PRE',
      replacement: (_c: string, n: any) => {
        const code = n.querySelector?.('code');
        const raw: string = (code ?? n).textContent ?? '';
        const lang = codeLanguage(code?.getAttribute?.('class'), n.getAttribute?.('class'), n.getAttribute?.('data-lang'), n.parentElement?.getAttribute?.('class'));
        const body = raw.replace(/\n+$/, '');
        const f = fenceFor(body);
        return `\n\n${f}${lang}\n${body}\n${f}\n\n`;
      },
    });
    // Absolute http(s) URLs only: javascript:, data: and relative links are resolved or dropped.
    td.addRule('safeLink', {
      filter: (n: any) => n.nodeName === 'A' && n.getAttribute('href'),
      replacement: (c: string, n: any) => {
        const href = absolute(n.getAttribute('href'), url);
        const text = c.trim();
        if (!text) return '';
        return href ? `[${text}](${href.replace(/[()]/g, encodeURIComponent)})` : text;
      },
    });
    td.addRule('safeImage', {
      filter: 'img',
      replacement: (_c: string, n: any) => {
        const src = absolute(n.getAttribute('src') || n.getAttribute('data-src'), url);
        const alt = (n.getAttribute('alt') ?? '').replace(/[\[\]\n]/g, ' ').trim();
        return src ? `![${alt}](${src.replace(/[()]/g, encodeURIComponent)})` : '';
      },
    });

    const body = td.turndown(article.content);
    const title = (article.title || doc.title || new URL(url).hostname).trim().slice(0, 300);
    return { title, byline: article.byline?.trim().slice(0, 200) || null, siteName: article.siteName?.trim() || siteName, lang: article.lang || lang, markdown: `# ${title}\n\n${body}` };
  } finally { dom.window.close(); }                 // frees the DOM promptly; important in a long-lived worker
}

/** Supabase-backed deps. `admin` is the service-role client from lib/server.ts. Every query filters by user_id. */
export function supabaseDeps(admin: any): ArchiveDeps {
  return {
    now: () => new Date(),
    fetchPage: defaultFetchPage,
    extract: defaultExtract,
    async claim(itemId, userId, now) {
      const stale = new Date(now.getTime() - STALE_CLAIM_MS).toISOString();
      let q = admin.from('oneclist_items')
        .update({ archive_status: 'processing', archive_claimed_at: now.toISOString(), archive_error: null })
        .eq('id', itemId)
        .or(`archive_status.in.(none,pending,failed,done),and(archive_status.eq.processing,archive_claimed_at.lt.${stale})`)
        .select('id,user_id,url,archive_hash,archive_attempts');
      if (userId) q = q.eq('user_id', userId);
      const { data, error } = await q.maybeSingle();
      if (error) throw new ArchiveError('db_error');
      return data ?? null;
    },
    async upload(path, body) {
      const { error } = await admin.storage.from('archives').upload(path, new Blob([body], { type: 'text/markdown' }), { upsert: true, contentType: 'text/markdown' });
      if (error) throw new Error(error.message);
    },
    async saveDone(row, r) {
      const { error } = await admin.from('oneclist_items').update({
        archive_status: 'done', archive_error: null, archived_at: r.now.toISOString(), archive_path: r.path, archive_hash: r.hash,
        archive_title: r.ex.title, archive_byline: r.ex.byline, archive_site: r.ex.siteName, archive_lang: r.ex.lang,
        archive_words: r.words, archive_minutes: r.minutes, archive_truncated: r.truncated, full_markdown_content: r.markdown,
        archive_attempts: row.archive_attempts + 1,
      }).eq('id', row.id).eq('user_id', row.user_id);
      if (error) throw new Error(error.message);
    },
    async saveFailed(row, code, now) {
      await admin.from('oneclist_items').update({
        archive_status: 'failed', archive_error: code, archive_attempts: row.archive_attempts + 1, archive_claimed_at: now.toISOString(),
      }).eq('id', row.id).eq('user_id', row.user_id);
    },
  };
}
