/** Pure serialisers (no I/O) so they can be unit-tested and reused by both routes. */

export interface ExportCollection { id: string; parent_id: string | null; name: string; }
export interface ExportItem {
  url: string; title: string; note: string | null; tags: string[]; collection_id: string | null;
  status: string; category: string | null; summary: string | null; action_items: unknown;
  remind_at: string | null; created_at: string;
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const epoch = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? Math.floor(t / 1000) : 0; };

export function collectionPaths(cols: ExportCollection[]): Map<string, string[]> {
  const byId = new Map(cols.map((c) => [c.id, c]));
  const out = new Map<string, string[]>();
  for (const c of cols) {
    const path: string[] = []; const seen = new Set<string>();
    for (let cur: ExportCollection | undefined = c; cur && !seen.has(cur.id); cur = cur.parent_id ? byId.get(cur.parent_id) : undefined) {
      seen.add(cur.id); path.unshift(cur.name);
    }
    out.set(c.id, path);
  }
  return out;
}

/** Netscape Bookmark File: opens in Chrome, Firefox, Safari, Edge, Raindrop, Pocket, Pinboard importers. */
export function* netscapeHtml(cols: ExportCollection[], items: ExportItem[], now = new Date()): Generator<string> {
  yield '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<!-- Exported from Bukmarkz. This is a standard bookmarks file. -->\n';
  yield '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n';

  const children = new Map<string | null, ExportCollection[]>();
  for (const c of cols) { const k = c.parent_id; (children.get(k) ?? children.set(k, []).get(k)!).push(c); }
  for (const arr of children.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
  const byCol = new Map<string | null, ExportItem[]>();
  for (const it of items) { const k = it.collection_id; (byCol.get(k) ?? byCol.set(k, []).get(k)!).push(it); }

  function* bookmark(it: ExportItem, pad: string): Generator<string> {
    const tags = it.tags.length ? ` TAGS="${escapeHtml(it.tags.join(','))}"` : '';
    yield `${pad}<DT><A HREF="${escapeHtml(it.url)}" ADD_DATE="${epoch(it.created_at)}"${tags}>${escapeHtml(it.title || it.url)}</A>\n`;
    if (it.note) yield `${pad}<DD>${escapeHtml(it.note)}\n`; // AI summary/actions live in the JSON export
  }
  function* walk(parent: string | null, depth: number, seen: Set<string>): Generator<string> {
    const pad = '    '.repeat(depth);
    for (const c of children.get(parent) ?? []) {
      if (seen.has(c.id)) continue; // cycle guard
      yield `${pad}<DT><H3>${escapeHtml(c.name)}</H3>\n${pad}<DL><p>\n`;
      yield* walk(c.id, depth + 1, new Set(seen).add(c.id));
      for (const it of byCol.get(c.id) ?? []) yield* bookmark(it, pad + '    ');
      yield `${pad}</DL><p>\n`;
    }
  }
  yield* walk(null, 1, new Set());
  for (const it of byCol.get(null) ?? []) yield* bookmark(it, '    ');
  yield `</DL><p>\n<!-- exported ${now.toISOString()} -->\n`;
}

export const JSON_FORMAT = 'bukmarkz-export';

export function jsonHeader(now = new Date()) {
  return `{"format":"${JSON_FORMAT}","version":1,"exported_at":${JSON.stringify(now.toISOString())},"items":[`;
}
export function jsonItem(it: ExportItem, paths: Map<string, string[]>) {
  return JSON.stringify({
    url: it.url, title: it.title, note: it.note, tags: it.tags,
    folder: it.collection_id ? paths.get(it.collection_id) ?? [] : [],
    status: it.status, category: it.category, summary: it.summary, action_items: it.action_items ?? [],
    remind_at: it.remind_at, created_at: it.created_at,
  });
}
