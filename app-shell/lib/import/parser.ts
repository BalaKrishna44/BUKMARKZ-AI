import { buildBookmark } from './normalize';
import type { ImportFormat, ParseOptions, ParseResult, ParsedBookmark } from './types';

/* ───────────── helpers ───────────── */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function stripBom(s: string): string { return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s; }

export function detectFormat(text: string, filename?: string): { format: ImportFormat; sourceGuess: string | null } {
  const head = stripBom(text).slice(0, 4096).trimStart();
  const ext = filename?.toLowerCase().split('.').pop();
  if (head.startsWith('<')) {
    const isHtml = /<!doctype\s+netscape-bookmark-file|<dl\b|<a\s[^>]*href/i.test(text.slice(0, 200_000));
    if (isHtml) {
      let src: string | null = null;
      if (/time_added=/i.test(text.slice(0, 20_000))) src = 'Pocket';
      else if (/Bookmarks Menu|places:/i.test(text.slice(0, 200_000))) src = 'Firefox';
      else if (/PERSONAL_TOOLBAR_FOLDER/i.test(text.slice(0, 20_000))) src = 'Chrome / Edge / Safari';
      return { format: 'netscape-html', sourceGuess: src };
    }
  }
  if (head.startsWith('[') || head.startsWith('{')) {
    let src: string | null = null;
    if (/"href"\s*:/.test(head)) src = 'Pinboard';
    else if (/"format"\s*:\s*"bukmarkz-export"/.test(head)) src = 'Bukmarkz';
    return { format: 'json', sourceGuess: src };
  }
  if (ext === 'csv' || /^[^\n]*,[^\n]*\n/.test(head)) {
    const first = head.split(/\r?\n/, 1)[0].toLowerCase();
    let src: string | null = null;
    if (first.includes('highlights') || (first.includes('excerpt') && first.includes('cover'))) src = 'Raindrop.io';
    else if (first.includes('time_added')) src = 'Pocket';
    else if (first.includes('selection')) src = 'Instapaper';
    else if (first.includes('created time') || first.startsWith('name,')) src = 'Notion';
    return { format: 'csv', sourceGuess: src };
  }
  return { format: 'unknown', sourceGuess: null };
}

/* ───────────── Netscape HTML ───────────── */

const TOKEN = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|<!--[\s\S]*?-->/g;
const ATTR = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function parseAttrs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR.exec(src))) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

/**
 * Tolerant single-pass tokenizer for the Netscape bookmark dialect. Browsers emit
 * unclosed <DT>/<p>/<DD> tags, so a real DOM parser is both heavier and no more reliable.
 * Works identically in Node, edge runtimes and the browser (no dependencies).
 */
export function parseNetscapeHtml(html: string, opts: ParseOptions = {}): ParseResult {
  const max = opts.maxItems ?? 50_000;
  const skipped = new Map<string, number>();
  const warnings: string[] = [];
  const items: ParsedBookmark[] = [];
  const stack: (string | null)[] = [];
  let pendingFolder: string | null = null;

  let anchor: { attrs: Record<string, string>; text: string; folder: string[] } | null = null;
  let inH3 = false, h3 = '';
  let ddTarget: { idx: number; text: string } | null = null;
  let lastIdx = -1;

  const folderNow = () => stack.filter((x): x is string => !!x);
  const skip = (r: string) => skipped.set(r, (skipped.get(r) ?? 0) + 1);
  const endDd = () => {
    if (ddTarget && items[ddTarget.idx]) {
      const t = decodeEntities(ddTarget.text).trim();
      if (t) items[ddTarget.idx].note = t.slice(0, 10_000);
    }
    ddTarget = null;
  };
  const endAnchor = () => {
    if (!anchor) return;
    const a = anchor.attrs;
    anchor = null;
    const r = buildBookmark({
      url: a.href, title: decodeEntities(a.__text ?? ''), note: a.description,
      tags: (a.tags ?? '').split(','), folder: a.__folder ? JSON.parse(a.__folder) : [],
      created: a.add_date ?? a.time_added,
    });
    if (!r.ok) { skip(r.reason); lastIdx = -1; return; }
    if (items.length >= max) { skip('over-limit'); lastIdx = -1; return; }
    items.push(r.item);
    lastIdx = items.length - 1;
  };

  let prev = 0, m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  const addText = (t: string) => {
    if (!t) return;
    if (anchor) anchor.text += t; else if (inH3) h3 += t; else if (ddTarget) ddTarget.text += t;
  };
  while ((m = TOKEN.exec(html))) {
    addText(html.slice(prev, m.index));
    prev = TOKEN.lastIndex;
    if (!m[2]) continue; // comment
    const closing = m[1] === '/', tag = m[2].toLowerCase();
    if (!closing) {
      if (tag === 'a') {
        if (anchor) endAnchor(); // unclosed <a>
        endDd();
        const attrs = parseAttrs(m[3] ?? '');
        anchor = { attrs, text: '', folder: folderNow() };
      } else if (tag === 'h3') { endDd(); inH3 = true; h3 = ''; }
      else if (tag === 'dl' || tag === 'ul' || tag === 'ol') { endDd(); stack.push(pendingFolder); pendingFolder = null; }
      else if (tag === 'dd') { endDd(); if (lastIdx >= 0) ddTarget = { idx: lastIdx, text: '' }; }
      else if (tag === 'dt' || tag === 'li' || tag === 'hr') endDd();
    } else {
      if (tag === 'a' && anchor) {
        anchor.attrs.__text = anchor.text.trim();
        anchor.attrs.__folder = JSON.stringify(anchor.folder);
        endAnchor();
      } else if (tag === 'h3' && inH3) { inH3 = false; pendingFolder = decodeEntities(h3).trim() || null; }
      else if (tag === 'dl' || tag === 'ul' || tag === 'ol') { endDd(); stack.pop(); pendingFolder = null; }
    }
  }
  addText(html.slice(prev));
  if (anchor) endAnchor();
  endDd();
  if (stack.length) warnings.push('File ended with unclosed folders (truncated export?).');

  return {
    format: 'netscape-html', sourceGuess: detectFormat(html).sourceGuess, items,
    skipped: [...skipped].map(([reason, count]) => ({ reason, count })), warnings,
  };
}

/* ───────────── CSV ───────────── */

/** RFC-4180 reader: quoted fields, escaped quotes, embedded newlines, CRLF/LF, BOM. */
export function parseCsvRows(input: string): string[][] {
  const s = stripBom(input);
  const rows: string[][] = [];
  let row: string[] = [], field = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"' && field === '') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const FIELD_ALIASES = {
  url: ['url', 'href', 'link', 'uri', 'address'],
  title: ['title', 'name'],
  note: ['note', 'notes', 'extended', 'selection', 'comment'],
  tags: ['tags', 'tag', 'labels'],
  folder: ['folder', 'folders', 'collection', 'list'],
  created: ['created', 'created_at', 'created time', 'time_added', 'timestamp', 'time', 'date', 'date added', 'added', 'add_date'],
} as const;

function pick(rec: Record<string, unknown>, names: readonly string[]): unknown {
  for (const n of names) { const v = rec[n]; if (v !== undefined && v !== null && v !== '') return v; }
  return undefined;
}

function toList(v: unknown, sep: RegExp): string[] {
  if (Array.isArray(v)) return v.map(String);
  return typeof v === 'string' ? v.split(sep) : [];
}

/** Maps one loose record (CSV row or JSON object) to a bookmark. Keys must be lower-cased. */
function fromRecord(rec: Record<string, unknown>, tagSep: RegExp) {
  const pinboard = 'href' in rec && 'extended' in rec; // Pinboard: description = title, extended = note, tags space-separated
  const folderRaw = pick(rec, FIELD_ALIASES.folder);
  return buildBookmark({
    url: pick(rec, FIELD_ALIASES.url),
    title: pinboard ? rec.description : pick(rec, FIELD_ALIASES.title),
    note: pick(rec, FIELD_ALIASES.note),
    tags: toList(pick(rec, FIELD_ALIASES.tags), pinboard ? /\s+/ : tagSep),
    folder: Array.isArray(folderRaw) ? folderRaw.map(String) : typeof folderRaw === 'string' ? [folderRaw] : [],
    created: pick(rec, FIELD_ALIASES.created),
  });
}

function collect(records: Iterable<Record<string, unknown>>, format: ImportFormat, src: string | null, tagSep: RegExp, max: number): ParseResult {
  const items: ParsedBookmark[] = [];
  const skipped = new Map<string, number>();
  for (const rec of records) {
    const r = fromRecord(rec, tagSep);
    if (!r.ok) { skipped.set(r.reason, (skipped.get(r.reason) ?? 0) + 1); continue; }
    if (items.length >= max) { skipped.set('over-limit', (skipped.get('over-limit') ?? 0) + 1); continue; }
    items.push(r.item);
  }
  return { format, sourceGuess: src, items, skipped: [...skipped].map(([reason, count]) => ({ reason, count })), warnings: [] };
}

export function parseCsv(text: string, opts: ParseOptions = {}): ParseResult {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return { format: 'csv', sourceGuess: null, items: [], skipped: [], warnings: ['CSV has no data rows.'] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  if (!header.some((h) => (FIELD_ALIASES.url as readonly string[]).includes(h))) {
    return { format: 'csv', sourceGuess: null, items: [], skipped: [], warnings: ['No URL column found. Expected a header such as "url", "href" or "link".'] };
  }
  const recs = rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
  // Raindrop uses ", ", Pocket uses "|", some tools use ";"
  return collect(recs, 'csv', detectFormat(text).sourceGuess, /[,;|]/, opts.maxItems ?? 50_000);
}

/* ───────────── JSON ───────────── */

export function parseJson(text: string, opts: ParseOptions = {}): ParseResult {
  let data: unknown;
  try { data = JSON.parse(stripBom(text)); }
  catch { return { format: 'json', sourceGuess: null, items: [], skipped: [], warnings: ['File is not valid JSON.'] }; }
  const list = Array.isArray(data) ? data
    : data && typeof data === 'object'
      ? ((data as any).items ?? (data as any).bookmarks ?? (data as any).links ?? null)
      : null;
  if (!Array.isArray(list)) return { format: 'json', sourceGuess: null, items: [], skipped: [], warnings: ['Expected an array of bookmarks (or { items: [...] }).'] };
  const recs = list.filter((x) => x && typeof x === 'object' && !Array.isArray(x)).map((o) =>
    Object.fromEntries(Object.entries(o as object).map(([k, v]) => [k.toLowerCase(), v])));
  return collect(recs, 'json', detectFormat(text).sourceGuess, /[,;|]/, opts.maxItems ?? 50_000);
}

/* ───────────── facade ───────────── */

export class BookmarkParser {
  constructor(private readonly opts: ParseOptions = {}) {}

  detect(text: string, filename?: string) { return detectFormat(text, filename); }

  parse(text: string, filename?: string): ParseResult {
    const { format } = detectFormat(text, filename);
    switch (format) {
      case 'netscape-html': return parseNetscapeHtml(text, this.opts);
      case 'csv': return parseCsv(text, this.opts);
      case 'json': return parseJson(text, this.opts);
      default:
        return { format: 'unknown', sourceGuess: null, items: [], skipped: [],
          warnings: ['Unrecognised file. Supported: Netscape bookmarks HTML, CSV, JSON.'] };
    }
  }
}
