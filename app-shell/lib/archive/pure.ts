// Pure helpers for the archiver: no network, no database, no DOM. Unit-tested without any dependency installed.
import { createHash } from 'node:crypto';

export const MAX_HTML_BYTES = 3 * 1024 * 1024;     // JSDOM builds a full DOM in memory: keep the input bounded
export const MAX_MD_CHARS = 250_000;               // keeps the generated tsvector far below Postgres' 1 MB limit
export const STALE_CLAIM_MS = 10 * 60_000;
export const WORDS_PER_MIN = 220;
export const CJK_CHARS_PER_MIN = 450;

export type ArchiveErrorCode =
  | 'bad_url' | 'blocked_address' | 'timeout' | 'network' | 'http_error' | 'not_html' | 'too_large'
  | 'no_readable_content' | 'storage_failed' | 'db_error' | 'parse_failed';

export class ArchiveError extends Error {
  constructor(public code: ArchiveErrorCode, message?: string) { super(message ?? code); }
}

/** Map whatever safeFetch / fetch throws onto a short, safe code. Never store raw error text from the network. */
export function classifyFetchError(e: unknown): ArchiveError {
  if (e instanceof ArchiveError) return e;
  const m = String((e as { message?: string })?.message ?? e).toLowerCase();
  if (m.includes('blocked address') || m.includes('private')) return new ArchiveError('blocked_address');
  if (m.includes('too large')) return new ArchiveError('too_large');
  if (m.includes('timeout') || m.includes('aborted') || (e as { name?: string })?.name === 'TimeoutError') return new ArchiveError('timeout');
  if (m.includes('url') || m.includes('protocol') || m.includes('invalid')) return new ArchiveError('bad_url');
  return new ArchiveError('network');
}

/** Decode bytes using the charset from the Content-Type header, then a <meta charset>, then UTF-8. Unknown labels fall back to UTF-8. */
export function decodeHtml(bytes: Uint8Array, contentType: string | null): string {
  const fromHeader = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType ?? '')?.[1];
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1];
  for (const label of [fromHeader, fromMeta, 'utf-8']) {
    if (!label) continue;
    try { return new TextDecoder(label, { fatal: false }).decode(bytes); } catch { /* unknown label: try the next */ }
  }
  return new TextDecoder().decode(bytes);
}

export const isHtmlType = (ct: string | null) => /^(text\/html|application\/xhtml\+xml)\b/i.test((ct ?? '').trim());

const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/g;
const FENCED = /^(```|~~~)[^\n]*\n[\s\S]*?^\1\s*$/gm;

/** Words (space-separated languages) + CJK characters, ignoring fenced code. */
export function countWords(markdown: string): { words: number; cjk: number } {
  const prose = markdown.replace(FENCED, ' ');
  const cjk = (prose.match(CJK) ?? []).length;
  const words = (prose.replace(CJK, ' ').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
  return { words, cjk };
}

/** Reading time in whole minutes (at least 1). Code blocks add a minute per 60 lines: people read code slower than prose. */
export function readingMinutes(markdown: string): number {
  const { words, cjk } = countWords(markdown);
  const codeLines = [...markdown.matchAll(FENCED)].reduce((n, m) => n + m[0].split('\n').length, 0);
  return Math.max(1, Math.ceil(words / WORDS_PER_MIN + cjk / CJK_CHARS_PER_MIN + codeLines / 60));
}

/** Markdown that Postgres and the reader can store safely: no NUL bytes (Postgres rejects them), no zero-width junk, tidy blank lines, bounded size. */
export function tidyMarkdown(md: string, max = MAX_MD_CHARS): { text: string; truncated: boolean } {
  let t = md.replace(/\u0000/g, '').replace(/[​‌‍⁠﻿]/g, '')
    .replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (t.length <= max) return { text: t, truncated: false };
  t = t.slice(0, max);
  const cut = Math.max(t.lastIndexOf('\n\n'), Math.floor(max * 0.9));        // end on a paragraph boundary when one is close
  t = t.slice(0, cut).trimEnd();
  if ((t.match(/^```/gm) ?? []).length % 2 === 1) t += '\n```';                // never leave a code fence open
  return { text: `${t}\n\n*… archive truncated (page too long).*`, truncated: true };
}

/** A fence longer than any run of backticks inside the code, so code that contains ``` cannot end its own block early. */
export function fenceFor(code: string): string {
  const longest = Math.max(2, ...(code.match(/`+/g) ?? []).map((r) => r.length));
  return '`'.repeat(longest + 1);
}

/** Language hint from the class names sites and highlighters use: language-js, lang-py, highlight-source-ts, brush: bash, data-lang. */
export function codeLanguage(...hints: (string | null | undefined)[]): string {
  const s = hints.filter(Boolean).join(' ');
  const m = /(?:language|lang|highlight-source|brush:)[-\s]*([a-z0-9+#]+)/i.exec(s) ?? /^\s*([a-z0-9+#]{1,20})\s*$/i.exec(hints[hints.length - 1] ?? '');
  const lang = (m?.[1] ?? '').toLowerCase();
  return ['none', 'plain', 'text', 'plaintext', 'nohighlight'].includes(lang) ? '' : lang;
}

export const storageKey = (userId: string, itemId: string) => `${userId}/${itemId}.md`;
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const yamlStr = (s: string) => JSON.stringify(s.replace(/[\u0000-\u001f]/g, ' ').slice(0, 300));

/** The standalone .md file: front matter (so the file explains itself offline) + the same body that goes to the database. */
export function fileWithFrontMatter(body: string, meta: { title: string; url: string; archivedAt: Date; site?: string | null; byline?: string | null; lang?: string | null; words?: number }): string {
  const lines = ['---', `title: ${yamlStr(meta.title)}`, `source: ${yamlStr(meta.url)}`, `archived: ${meta.archivedAt.toISOString()}`];
  if (meta.site) lines.push(`site: ${yamlStr(meta.site)}`);
  if (meta.byline) lines.push(`author: ${yamlStr(meta.byline)}`);
  if (meta.lang) lines.push(`lang: ${yamlStr(meta.lang)}`);
  if (meta.words) lines.push(`words: ${meta.words}`);
  lines.push('---', '', '');
  return lines.join('\n') + body + '\n';
}
