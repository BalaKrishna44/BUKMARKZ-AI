/** Shared types + pure helpers (no React, no Supabase) so server, client and tests all use one definition. */
export interface Category { id: string; name: string; position: number }
export interface Bookmark {
  id: string; title: string; url: string; note: string | null;
  summary: string | null;              // AI TL;DR, falling back to the page's own meta description
  tags: string[];                      // AI tags first, then the user's own, de-duplicated
  aiTags: string[]; userTags: string[];   // the two stored columns, kept apart so edits write back to the right one
  isTask: boolean; completedAt: string | null;   // item_type = 'oneclist_task'; completed_at is set when it is done
  faviconUrl: string | null; categoryId: string | null; createdAt: string;
}
/** Columns read from `oneclist_items`. Needs sql 002 (categories, ai_tags, item_type), 004 (summary) and 005 (favicon_url, meta_description). */
export const ITEM_COLUMNS = 'id,title,url,note,tags,ai_tags,summary,meta_description,favicon_url,category_id,created_at,item_type,completed_at';
export interface ItemRow {
  id: string; title: string | null; url: string; note: string | null; tags: string[] | null; ai_tags: string[] | null;
  summary: string | null; meta_description: string | null; favicon_url: string | null; category_id: string | null; created_at: string;
  item_type?: string | null; completed_at?: string | null;
}

export const ALL = 'all';
export const UNSORTED = 'unsorted';
export const TASKS = 'tasks';

const isHttp = (u: string | null | undefined): u is string => { if (!u) return false; try { const p = new URL(u).protocol; return p === 'http:' || p === 'https:'; } catch { return false; } };
export const domainOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url.slice(0, 40); } };

/** Database rows are data, not code: only http(s) links survive, so a stored `javascript:` URL can never become a clickable href. */
export function toBookmark(r: ItemRow): Bookmark | null {
  if (!isHttp(r.url)) return null;
  const tags = [...(r.ai_tags ?? []), ...(r.tags ?? [])].filter((t, i, a) => t && a.indexOf(t) === i);
  return {
    id: r.id, url: r.url, title: r.title?.trim() || domainOf(r.url), note: r.note,
    summary: r.summary?.trim() || r.meta_description?.trim() || null, tags,
    aiTags: (r.ai_tags ?? []).filter(Boolean), userTags: (r.tags ?? []).filter(Boolean),
    isTask: r.item_type === 'oneclist_task', completedAt: r.completed_at ?? null,
    faviconUrl: isHttp(r.favicon_url) ? r.favicon_url : null, categoryId: r.category_id, createdAt: r.created_at,
  };
}

export function searchMatches(b: Bookmark, query: string, categoryName: string | null): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = `${b.title} ${b.url} ${b.summary ?? ''} ${b.note ?? ''} ${b.tags.join(' ')} ${categoryName ?? ''}`.toLowerCase();
  // "#rag" means the TAG rag (so it does not match "p-rag-matic"); plain words match anywhere
  return terms.every((t) => (t.startsWith('#') ? t.length > 1 && b.tags.some((x) => x.toLowerCase() === t.slice(1)) : hay.includes(t)));
}

export function timeAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso); if (Number.isNaN(t)) return '';
  const s = Math.max(0, (now - t) / 1000);
  const f = (n: number, u: string) => `${n} ${u}${n === 1 ? '' : 's'} ago`;
  if (s < 60) return 'just now';
  if (s < 3600) return f(Math.floor(s / 60), 'minute');
  if (s < 86400) return f(Math.floor(s / 3600), 'hour');
  if (s < 86400 * 30) return f(Math.floor(s / 86400), 'day');
  if (s < 86400 * 365) return f(Math.floor(s / (86400 * 30)), 'month');
  return f(Math.floor(s / (86400 * 365)), 'year');
}

/* ───────────── tags ───────────── */
export const MAX_TAGS = 20, MAX_TAG_LEN = 30;
/** "#Next JS" -> "next-js". Returns null for anything that has no letters or digits. */
export function normalizeTag(raw: string): string | null {
  const t = raw.normalize('NFKC').trim().replace(/^#+/, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, MAX_TAG_LEN).replace(/-+$/, '');
  return t || null;
}
/** Free text ("react, next js  #rag") -> clean, de-duplicated tags. */
export function parseTagInput(text: string): string[] {
  const out: string[] = [];
  for (const piece of text.split(/[,\s]+/)) { const t = normalizeTag(piece); if (t && !out.includes(t)) out.push(t); if (out.length === MAX_TAGS) break; }
  return out;
}
/** After editing, decide which column each tag belongs to: a tag the AI wrote stays in ai_tags, every new one is the user's own. */
export function splitTags(b: Pick<Bookmark, 'aiTags'>, kept: string[]): { ai_tags: string[]; tags: string[] } {
  const clean = [...new Set(kept.map(normalizeTag).filter((t): t is string => !!t))].slice(0, MAX_TAGS);
  const ai = new Set(b.aiTags.map((t) => normalizeTag(t) ?? t));
  return { ai_tags: clean.filter((t) => ai.has(t)), tags: clean.filter((t) => !ai.has(t)) };
}

/* ───────────── realtime ───────────── */
const strArr = (v: unknown): string[] | null => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
/** A realtime payload is untrusted JSON: rebuild a typed row from it, or reject it. */
export function rowFromPayload(x: unknown): ItemRow | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.url !== 'string' || typeof r.created_at !== 'string') return null;
  return {
    id: r.id, url: r.url, created_at: r.created_at, title: strOrNull(r.title), note: strOrNull(r.note), tags: strArr(r.tags), ai_tags: strArr(r.ai_tags),
    summary: strOrNull(r.summary), meta_description: strOrNull(r.meta_description), favicon_url: strOrNull(r.favicon_url), category_id: strOrNull(r.category_id),
    item_type: strOrNull(r.item_type), completed_at: strOrNull(r.completed_at),
  };
}
export type Change = { kind: 'upsert'; row: ItemRow } | { kind: 'delete'; id: string };
/** Pure reducer for realtime events: idempotent, so our own optimistic edit echoing back changes nothing. */
export function applyChange(items: Bookmark[], ch: Change): Bookmark[] {
  if (ch.kind === 'delete') return items.some((b) => b.id === ch.id) ? items.filter((b) => b.id !== ch.id) : items;
  const next = toBookmark(ch.row);
  if (!next) return items.some((b) => b.id === ch.row.id) ? items.filter((b) => b.id !== ch.row.id) : items;   // URL no longer safe: drop it
  const i = items.findIndex((b) => b.id === next.id);
  if (i >= 0) { const copy = items.slice(); copy[i] = next; return copy; }
  const at = items.findIndex((b) => b.createdAt < next.createdAt);                                            // keep newest-first
  return at < 0 ? [...items, next] : [...items.slice(0, at), next, ...items.slice(at)];
}
