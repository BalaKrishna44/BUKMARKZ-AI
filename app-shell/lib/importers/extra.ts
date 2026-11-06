/**
 * Extra importers: browser bookmark files (Chrome/Edge/Firefox/Safari), Reddit saved, YouTube Watch Later, Readwise/Reader CSV.
 * Pure functions, no DOM. Everything runs in the browser or on the server; nothing is fetched.
 * Output is a neutral ImportRow; map it to your own ImportItem type in one place (see toImportItem in README).
 * Export column names are from memory of each service's current export and may change: parsers match headers loosely and
 * return `warnings` instead of throwing when a column is missing.
 */
export interface ImportRow { url: string; title: string; folder?: string; tags?: string[]; savedAt?: string; source: ImportSource }
export type ImportSource = 'browser_html' | 'reddit' | 'youtube_watch_later' | 'readwise';
export interface ParseResult { rows: ImportRow[]; skipped: number; duplicates: number; warnings: string[]; truncated: boolean }

export const MAX_ROWS = 20_000;
const TRACKING = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|igshid|ref_src|ref_url|_hsenc|_hsmi)$/i;

/** http(s) only, no credentials, tracking params removed, fragment kept (it can be meaningful). Returns null when unusable. */
export function normalizeUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s || s.length > 2048) return null;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.hostname = u.hostname.toLowerCase();
  return u.toString();
}
const dedupeKey = (url: string) => url.replace(/#.*$/, '').replace(/\/$/, '');

function finish(rows: ImportRow[], skipped: number, warnings: string[]): ParseResult {
  const seen = new Set<string>(); const out: ImportRow[] = []; let duplicates = 0;
  for (const r of rows) {
    const k = dedupeKey(r.url);
    if (seen.has(k)) { duplicates++; continue; }
    seen.add(k); out.push(r);
  }
  const truncated = out.length > MAX_ROWS;
  return { rows: truncated ? out.slice(0, MAX_ROWS) : out, skipped, duplicates, warnings: truncated ? [...warnings, `Only the first ${MAX_ROWS} links were kept.`] : warnings, truncated };
}

/* ---------- CSV (RFC 4180: quotes, escaped quotes, CRLF, commas and newlines inside quotes) ---------- */
export function parseCsv(text: string): string[][] {
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = []; let row: string[] = []; let f = ''; let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; }
    else f += c;
  }
  row.push(f); if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}
const col = (header: string[], ...names: string[]) => {
  const h = header.map((x) => x.trim().toLowerCase());
  for (const n of names) { const i = h.indexOf(n); if (i >= 0) return i; }
  return -1;
};
/** Spreadsheet injection guard: a title that starts with = + - @ is only dangerous if re-exported to CSV; we strip it at the source. */
const safeTitle = (s: string) => s.replace(/^[=+\-@\t\r]+/, '').replace(/\s+/g, ' ').trim().slice(0, 200);

/* ---------- Browser bookmarks (Netscape bookmark file) ---------- */
const decodeEntities = (s: string) => s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|#39);/gi, (m, e: string) => {
  const l = e.toLowerCase();
  if (l === 'amp') return '&'; if (l === 'lt') return '<'; if (l === 'gt') return '>'; if (l === 'quot') return '"'; if (l === 'apos') return "'";
  try { const n = l[1] === 'x' ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; } catch { return m; }
});
const attr = (tag: string, name: string) => { const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i')); return m ? decodeEntities(m[2] ?? m[3] ?? '') : undefined; };

export function parseBrowserHtml(html: string): ParseResult {
  const rows: ImportRow[] = []; let skipped = 0; const warnings: string[] = [];
  const stack: string[] = []; let pendingFolder: string | null = null;
  // Walk tags in order: <H3> names a folder, the next <DL> opens it, </DL> closes it, <A> is a link.
  const re = /<(\/?)(h3|dl|a)\b([^>]*)>([\s\S]*?(?=<(?:\/?(?:h3|dl|a|dt|dd|p)\b)|$))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const closing = m[1] === '/'; const name = m[2].toLowerCase(); const attrs = m[3]; const after = m[4];
    if (name === 'h3' && !closing) { const nm = decodeEntities(after.replace(/<[^>]*>/g, '')).trim(); pendingFolder = nm || null; }
    else if (name === 'dl' && !closing) { stack.push(pendingFolder ?? ''); pendingFolder = null; }
    else if (name === 'dl' && closing) stack.pop();
    else if (name === 'a' && !closing) {
      const href = attr(attrs, 'href'); const url = href ? normalizeUrl(href) : null;
      if (!url) { skipped++; continue; }
      const title = safeTitle(decodeEntities(after.replace(/<[^>]*>/g, ''))) || url;
      const folder = stack.filter(Boolean).slice(-3).join(' / ') || undefined;
      const tagsAttr = attr(attrs, 'tags'); const add = attr(attrs, 'add_date');
      const ts = add && /^\d{9,11}$/.test(add) ? new Date(Number(add) * 1000).toISOString() : undefined;
      rows.push({ url, title, folder, tags: tagsAttr ? tagsAttr.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 10) : undefined, savedAt: ts, source: 'browser_html' });
    }
  }
  if (!rows.length && !skipped) warnings.push('No bookmarks found. Export from Chrome/Edge/Firefox/Safari as "HTML".');
  return finish(rows, skipped, warnings);
}

/* ---------- Reddit saved (account data export: saved_posts.csv, saved_comments.csv) ---------- */
export function parseRedditSaved(csv: string): ParseResult {
  const t = parseCsv(csv); const warnings: string[] = [];
  if (t.length < 2) return finish([], 0, ['The file is empty.']);
  const ci = col(t[0], 'permalink', 'url');
  if (ci < 0) return finish([], t.length - 1, ['No "permalink" column. Use saved_posts.csv from Reddit\'s data request.']);
  const rows: ImportRow[] = []; let skipped = 0;
  for (const r of t.slice(1)) {
    let raw = (r[ci] ?? '').trim();
    if (raw.startsWith('/')) raw = 'https://www.reddit.com' + raw;
    const url = normalizeUrl(raw);
    if (!url) { skipped++; continue; }
    const slug = url.split('/').filter(Boolean).slice(-1)[0] ?? '';
    rows.push({ url, title: safeTitle(slug.replace(/[_-]+/g, ' ')) || 'Reddit post', source: 'reddit' });
  }
  warnings.push('Reddit exports have no post titles; titles are taken from the link and can be improved by enrichment.');
  return finish(rows, skipped, warnings);
}

/* ---------- YouTube Watch Later (Google Takeout: "Watch later.csv") ---------- */
export function parseYoutubeWatchLater(csv: string): ParseResult {
  const t = parseCsv(csv);
  if (t.length < 2) return finish([], 0, ['The file is empty.']);
  const ci = col(t[0], 'video id', 'video_id', 'videoid');
  if (ci < 0) return finish([], t.length - 1, ['No "Video ID" column. Use the playlist CSV from Google Takeout (YouTube and YouTube Music).']);
  const ti = col(t[0], 'playlist video creation timestamp', 'timestamp');
  const rows: ImportRow[] = []; let skipped = 0;
  for (const r of t.slice(1)) {
    const id = (r[ci] ?? '').trim();
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) { skipped++; continue; }
    const d = ti >= 0 ? new Date(r[ti] ?? '') : null;
    rows.push({ url: `https://www.youtube.com/watch?v=${id}`, title: `YouTube video ${id}`, savedAt: d && !isNaN(+d) ? d.toISOString() : undefined, source: 'youtube_watch_later' });
  }
  return finish(rows, skipped, ['Takeout has only video IDs, so titles are placeholders until enrichment fetches them.']);
}

/* ---------- Readwise / Reader CSV ---------- */
export function parseReadwise(csv: string): ParseResult {
  const t = parseCsv(csv);
  if (t.length < 2) return finish([], 0, ['The file is empty.']);
  const ui = col(t[0], 'url', 'source url', 'source_url');
  if (ui < 0) return finish([], t.length - 1, ['No URL column found. In Reader use Export > CSV; highlight-only exports have no links.']);
  const ti = col(t[0], 'title', 'book title'); const gi = col(t[0], 'tags', 'document tags'); const di = col(t[0], 'saved date', 'created date', 'date saved');
  const rows: ImportRow[] = []; let skipped = 0;
  for (const r of t.slice(1)) {
    const url = normalizeUrl(r[ui] ?? '');
    if (!url) { skipped++; continue; }
    const d = di >= 0 ? new Date(r[di] ?? '') : null;
    rows.push({
      url, title: safeTitle(r[ti] ?? '') || url,
      tags: gi >= 0 ? (r[gi] ?? '').split(/[,;]/).map((x) => x.trim()).filter(Boolean).slice(0, 10) : undefined,
      savedAt: d && !isNaN(+d) ? d.toISOString() : undefined, source: 'readwise',
    });
  }
  return finish(rows, skipped, []);
}

/** Choose a parser from the file name and a peek at the content. Returns null when nothing matches. */
export function detectAndParse(fileName: string, text: string): (ParseResult & { format: ImportSource }) | null {
  const head = text.slice(0, 4000).toLowerCase(); const name = fileName.toLowerCase();
  if (/<!doctype netscape-bookmark|<dt><a |<h3/.test(head) || /\.html?$/.test(name)) return { ...parseBrowserHtml(text), format: 'browser_html' };
  if (name.endsWith('.csv') || head.includes(',')) {
    const hdr = parseCsv(head.split(/\r?\n/)[0] ?? '')[0]?.map((x) => x.trim().toLowerCase()) ?? [];
    if (hdr.includes('video id') || hdr.includes('video_id')) return { ...parseYoutubeWatchLater(text), format: 'youtube_watch_later' };
    if (hdr.includes('permalink')) return { ...parseRedditSaved(text), format: 'reddit' };
    if (hdr.includes('url') || hdr.includes('source url') || hdr.includes('source_url')) return { ...parseReadwise(text), format: 'readwise' };
  }
  return null;
}
