/**
 * Pure code-snippet extraction. No DOM, no network, no Node APIs: the same module runs in the API route, in tests and
 * (copied) in the extension. Everything here treats input as untrusted text and only ever returns strings.
 */

export const MAX_CODE_CHARS = 20_000;
export const MIN_CODE_CHARS = 8;
export const MAX_BLOCKS = 25;

export interface Candidate { code: string; language: string; title: string; lines: number; secret: string | null }

// ---------- languages ----------
const ALIASES: Record<string, string> = {
  js: 'javascript', node: 'javascript', nodejs: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', py: 'python', python3: 'python', py3: 'python',
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', terminal: 'bash', 'shell-session': 'bash', yml: 'yaml', 'c++': 'cpp', cc: 'cpp', 'c#': 'csharp', cs: 'csharp',
  golang: 'go', rs: 'rust', rb: 'ruby', kt: 'kotlin', md: 'markdown', htm: 'html', xhtml: 'html', pgsql: 'sql', postgresql: 'sql', mysql: 'sql', plsql: 'sql', psql: 'sql',
  docker: 'dockerfile', ps1: 'powershell', pwsh: 'powershell', objc: 'objective-c', tex: 'latex', jsonc: 'json', json5: 'json', vue: 'html', svelte: 'html',
  plaintext: 'text', plain: 'text', txt: 'text', none: 'text', nohighlight: 'text',
};
export const LANGUAGES = new Set([
  'javascript', 'typescript', 'jsx', 'tsx', 'python', 'bash', 'powershell', 'yaml', 'json', 'toml', 'ini', 'xml', 'html', 'css', 'scss', 'sql', 'graphql', 'markdown',
  'c', 'cpp', 'csharp', 'java', 'kotlin', 'swift', 'objective-c', 'go', 'rust', 'ruby', 'php', 'perl', 'lua', 'r', 'dart', 'scala', 'elixir', 'haskell', 'dockerfile',
  'makefile', 'nginx', 'diff', 'latex', 'regex', 'text',
]);
/** "language-ts" / "Python" / "highlight-source-js" -> a known language id, or null. */
export function normalizeLanguage(raw: string | null | undefined): string | null {
  let s = (raw ?? '').toLowerCase().trim().replace(/^(?:language|lang|highlight-source|brush:|sourcecode|prism|hljs|code-)[-_:\s]*/i, '').replace(/[^a-z0-9+#-]/g, '');
  if (!s) return null;
  s = ALIASES[s] ?? s;
  return LANGUAGES.has(s) ? s : null;
}

/** Class-name / attribute hints -> language. Looks at `language-x`, `lang-x`, `highlight-source-x`, `brush: x`, `data-lang`. */
export function languageFromAttrs(attrs: string): string | null {
  const m = /(?:data-(?:lang|language)|lang)=["']([^"']+)["']/i.exec(attrs);
  if (m) { const l = normalizeLanguage(m[1]); if (l) return l; }
  const cls = /class=["']([^"']+)["']/i.exec(attrs)?.[1] ?? '';
  for (const c of cls.split(/\s+/)) {
    const k = /^(?:language|lang|highlight-source|brush:?|sourcecode|prettyprint-)[-_:]?(.+)$/i.exec(c);
    if (k) { const l = normalizeLanguage(k[1]); if (l) return l; }
  }
  for (const c of cls.split(/\s+/)) { const l = /^(?:hljs|prism)$/i.test(c) ? null : normalizeLanguage(c); if (l && l !== 'text' && c.length > 1) return l; }
  return null;
}

/** Heuristic detection for blocks without a hint. Ordered from most to least specific; falls back to 'text'. */
export function detectLanguage(code: string): string {
  const t = code.trim(), head = t.slice(0, 2000);
  if (/^#!.*\b(ba|z)?sh\b/.test(head)) return 'bash';
  if (/^#!.*\bpython/.test(head)) return 'python';
  if (/^#!.*\bnode\b/.test(head)) return 'javascript';
  if (/^<\?php/i.test(head)) return 'php';
  if (/^(diff --git|@@ -\d+)/m.test(head) || (/^[-+]{3} \S/m.test(head) && /^@@/m.test(head))) return 'diff';
  if (/^\s*FROM\s+\S+/m.test(head) && /^\s*(RUN|CMD|COPY|ENTRYPOINT|WORKDIR|EXPOSE)\b/m.test(head)) return 'dockerfile';
  if (/^[[{]/.test(t)) { try { JSON.parse(t); return 'json'; } catch { /* not strict JSON */ } }
  if (/^<!doctype html|^<html[\s>]/i.test(head) || /^<(div|section|nav|main|ul|form|button|head|body)\b/i.test(head)) return 'html';
  if (/^<\?xml|^<[a-z][\w:-]*(\s[^>]*)?>[\s\S]*<\/[a-z][\w:-]*>\s*$/i.test(head) && !/\b(function|const|let|=>)\b/.test(head)) return 'xml';
  if (/^\s*(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+(TABLE|INDEX|OR\s+REPLACE|FUNCTION|VIEW|EXTENSION)|ALTER\s+TABLE|DROP\s+TABLE|WITH\s+\w+\s+AS)\b/im.test(head)) return 'sql';
  if (/^\s*(\$ |# )?(npm|npx|pnpm|yarn|pip3?|git|docker|kubectl|curl|wget|sudo|apt(-get)?|brew|cd|ls|cat|export|chmod|mkdir|echo|python3?|node|cargo|go (run|build|get|mod)|make)\b/m.test(head) && !/[{};]\s*$/m.test(head.split('\n')[0] ?? '')) return 'bash';
  if (/^\s*#include\s*[<"]/m.test(head)) return /\b(std::|cout|class\s+\w+\s*[:{]|template\s*<)/.test(head) ? 'cpp' : 'c';
  if (/^package\s+\w+/m.test(head) && /\bfunc\b/.test(head) || /\bfunc\s+(\(\w+\s+\*?\w+\)\s*)?\w+\(/.test(head) || /\b\w+\s*:=\s*/.test(head) && /\bfmt\./.test(head)) return 'go';
  if (/\bfn\s+\w+\s*(<[^>]*>)?\(/.test(head) || /\blet\s+mut\b|\bimpl\s+\w+|println!\(|\buse\s+std::/.test(head)) return 'rust';
  if (/\bpublic\s+(static\s+)?(class|void|interface)\b|System\.out\.print/.test(head)) return /\bfun\s+\w+|\bval\s+\w+\s*[:=]/.test(head) ? 'kotlin' : 'java';
  if (/\bfun\s+\w+\s*\(|\bval\s+\w+\s*[:=]|\bdata class\b/.test(head)) return 'kotlin';
  if (/\bnamespace\s+[\w.]+|\busing\s+System\b|\bConsole\.Write/.test(head)) return 'csharp';
  if (/^\s*(def|class)\s+\w+.*:\s*$/m.test(head) || /^\s*(import\s+\w+|from\s+[\w.]+\s+import)\b(?!.*[;'"])/m.test(head) || /\bprint\(|\belif\b|\bself\.\w+|__name__\s*==/.test(head)) return 'python';
  if (/\b(interface|type)\s+\w+\s*(<[^>]*>)?\s*(=|\{)/.test(head) || /:\s*(string|number|boolean|void|unknown|any)\b/.test(head) || /\bas\s+const\b|\bimport type\b|<\w+>\(/.test(head) || /\)\s*:\s*(?:Promise<|JSX\.|React\.|[A-Z]\w*(?:<[^>]*>)?\s*(?:\{|=>))/.test(head)) {
    return /<\/?[A-Z]\w*[\s/>]/.test(head) ? 'tsx' : 'typescript';
  }
  if (/\b(const|let|var)\s+[\w{[]|\bfunction\b|=>|console\.\w+\(|\brequire\(|\bexport\s+(default|const|function)\b|\bimport\s.+\sfrom\s/.test(head)) return /<\/?[A-Z]\w*[\s/>]|<\/?(div|span|p|button)[\s/>]/.test(head) ? 'jsx' : 'javascript';
  if (/^\s*(@(media|import|keyframes)|[.#]?[\w-][\w\s.#:,>+~-]*\{\s*[\w-]+\s*:)/m.test(head)) return /\$[\w-]+\s*:|@mixin|@include/.test(head) ? 'scss' : 'css';
  if (/^\s*\w[\w-]*:\s*(\S.*)?$/m.test(head) && (head.match(/^\s*[\w-]+:\s/gm) ?? []).length >= 2 && !/[;{}]/.test(head)) return 'yaml';
  if (/^\s*(require|puts|end)\b|\bdef\s+\w+\s*$/m.test(head) && /\bend\s*$/m.test(head)) return 'ruby';
  return 'text';
}

// ---------- cleaning ----------
const ENT: Record<string, string> = { mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', copy: '©', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'", '#x2F': '/', '#47': '/' };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n >= 9 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) && (n >= 32 || n === 9 || n === 10) ? String.fromCodePoint(n) : '';
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}

/** Normalise a block: LF endings, no control chars, trailing spaces trimmed, common indent removed, blank edges dropped, `$ ` prompts stripped. */
export function cleanCode(raw: string): string {
  let s = raw.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‍﻿]/g, '').replace(/ /g, ' ').replace(/\t/g, '\t');
  let lines = s.split('\n').map((l) => l.replace(/[ \t]+$/, ''));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const nonEmpty = lines.filter((l) => l.trim());
  if (nonEmpty.length && nonEmpty.every((l) => /^\$ /.test(l))) lines = lines.map((l) => l.replace(/^\$ /, ''));         // copy-paste friendly shell
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length), Infinity);
  if (Number.isFinite(indent) && indent > 0) lines = lines.map((l) => l.slice(Math.min(indent, /^[ \t]*/.exec(l)![0].length)));
  return lines.join('\n');
}

export function worthSaving(code: string): boolean {
  if (code.length < MIN_CODE_CHARS || code.length > MAX_CODE_CHARS) return false;
  const lines = code.split('\n').filter((l) => l.trim()).length;
  if (lines < 2 && code.length < 12) return false;        // a lone `ls` is noise; `npm i pg` is not
  return /[A-Za-z0-9]/.test(code) && (code.match(/[^\s]/g)?.length ?? 0) >= 6;
}

// ---------- secrets: never store credentials that happen to be on a page ----------
const PLACEHOLDER = /your[_-]|<[^>]+>|\bxxx+|example|changeme|placeholder|\*{3,}|\.{3}|todo|redacted|dummy|sample|\{\{|\$\{|process\.env|os\.environ|getenv/i;
const SECRET_PATTERNS: [string, RegExp][] = [
  ['private key', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY(?: BLOCK)?-----/],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/],
  ['Anthropic/OpenAI key', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Stripe key', /\b[rs]k_live_[0-9A-Za-z]{16,}\b/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
];
const ASSIGN = /\b(?:pass(?:word)?|passwd|secret|token|api[_-]?key|access[_-]?key|auth)\b["']?\s*[:=]\s*["']([^"'\s]{12,})["']/gi;
/** Name of the credential type if the block looks like it contains a real secret, else null. Conservative about doc placeholders. */
export function secretKind(code: string): string | null {
  for (const [name, re] of SECRET_PATTERNS) { const m = re.exec(code); if (m && !PLACEHOLDER.test(m[0])) return name; }
  for (const m of code.matchAll(ASSIGN)) if (!PLACEHOLDER.test(m[1]) && /[0-9]/.test(m[1]) && /[A-Za-z]/.test(m[1])) return 'hard-coded credential';
  return null;
}

// ---------- HTML extraction ----------
const HEADING = /<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi;
const strip = (h: string) => decodeEntities(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function blockText(inner: string): string {
  return decodeEntities(
    inner.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|li|tr|p)>/gi, '\n')
      .replace(/<(?:span|a|b|i|em|strong|mark|u|s|font)\b[^>]*\bclass=["'][^"']*\b(?:linenos?|line-number|lineno|hljs-ln-numbers|gutter|copy|btn)\b[^"']*["'][^>]*>[\s\S]*?<\/(?:span|a|b|i|em|strong|mark|u|s|font)>/gi, '')   // line-number gutters and copy buttons
      .replace(/<(button|svg|script|style)\b[\s\S]*?<\/\1>/gi, '')
      .replace(/<[^>]+>/g, ''),
  );
}

/** Pull code blocks (`<pre>`, optionally with an inner `<code>`) out of an HTML document, with language and a title taken from the nearest heading. */
export function extractFromHtml(html: string, opts: { max?: number } = {}): { pageTitle: string; blocks: Candidate[] } {
  const max = Math.min(opts.max ?? MAX_BLOCKS, MAX_BLOCKS);
  const src = html.slice(0, 3_000_000).replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, ' ');      // a <pre> inside a JS string is not content
  const pageTitle = strip(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(src)?.[1] ?? '').slice(0, 200);
  const out: Candidate[] = []; const seen = new Set<string>();
  const re = /<pre\b([^>]*)>([\s\S]*?)<\/pre>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) && out.length < max) {
    const attrs = m[1], inner = m[2];
    const codeTag = /<code\b([^>]*)>/i.exec(inner);
    const wrapAttrs = src.slice(Math.max(0, m.index - 240), m.index).match(/<(?:div|figure|section)\b[^>]*>(?![\s\S]*<(?:div|figure|section)\b)/gi)?.pop() ?? '';
    const hint = languageFromAttrs(attrs) ?? (codeTag ? languageFromAttrs(codeTag[1]) : null) ?? languageFromAttrs(wrapAttrs);
    const code = cleanCode(blockText(inner));
    if (!worthSaving(code)) continue;
    const key = code.replace(/\s+/g, ' ');
    if (seen.has(key)) continue; seen.add(key);

    // nearest preceding heading within 4 KB
    let title = '';
    const before = src.slice(Math.max(0, m.index - 4000), m.index);
    for (const h of before.matchAll(HEADING)) title = strip(h[1]);
    out.push({ code, language: hint ?? detectLanguage(code), title: title.slice(0, 120) || titleFromCode(code), lines: code.split('\n').length, secret: secretKind(code) });
  }
  return { pageTitle, blocks: out };
}

/** A readable title when the page offers none: the first comment or code line. */
export function titleFromCode(code: string): string {
  const first = code.split('\n').map((l) => l.trim()).find((l) => l && !/^(#!|<\?|["']use strict["'])/.test(l)) ?? 'Snippet';
  return first.replace(/^(?:\/\/+|#+|--|\/\*+|\*+|<!--)\s*/, '').replace(/\s*(?:\*\/|-->)\s*$/, '').slice(0, 80) || 'Snippet';
}

/** Clean a client-provided block the same way the server-side extractor would (used by the save endpoint: never trust the client's cleaning). */
export function prepareForSave(input: { code: string; language?: string | null; title?: string | null }): Candidate | { error: 'too_short' | 'too_long' | 'secret'; secret?: string } {
  if (input.code.length > MAX_CODE_CHARS * 2) return { error: 'too_long' };
  const code = cleanCode(input.code);
  if (code.length > MAX_CODE_CHARS) return { error: 'too_long' };
  if (!worthSaving(code)) return { error: 'too_short' };
  const secret = secretKind(code);
  if (secret) return { error: 'secret', secret };
  const language = normalizeLanguage(input.language) ?? detectLanguage(code);
  const title = (input.title ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || titleFromCode(code);
  return { code, language, title, lines: code.split('\n').length, secret: null };
}
