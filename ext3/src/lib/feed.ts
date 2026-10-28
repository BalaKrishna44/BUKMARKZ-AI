/** Pure feed logic (no chrome.*, no network) so it is unit-testable. */
export interface FeedItem {
  id: string; title: string; url: string; favicon_url: string | null;
  ai_category: string | null; summary_tldr: string | null; created_at: string;
}
export const UNCATEGORIZED = 'Uncategorized';
export const ALL = 'All';

const isHttp = (u: unknown): u is string => { if (typeof u !== 'string') return false; try { const p = new URL(u).protocol; return p === 'http:' || p === 'https:'; } catch { return false; } };
export const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url.slice(0, 40); } };
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** The server's rows are untrusted data (a page title can be anything): keep only well-formed rows with http(s) links. */
export function parseFeedRows(json: unknown): FeedItem[] {
  if (!Array.isArray(json)) return [];
  const out: FeedItem[] = [];
  for (const r of json as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !isHttp(r.url)) continue;
    out.push({
      id: r.id, url: r.url,
      title: str(r.title, 300) || hostOf(r.url),
      favicon_url: isHttp(r.favicon_url) ? r.favicon_url : null,
      ai_category: str(r.ai_category, 60) || null,
      summary_tldr: str(r.summary_tldr, 600) || null,
      created_at: typeof r.created_at === 'string' && !Number.isNaN(Date.parse(r.created_at)) ? r.created_at : new Date(0).toISOString(),
    });
  }
  return out;
}

export interface Group { name: string; items: FeedItem[] }
/** Reducer instead of Object.groupBy (needs Chrome 117; the manifest allows 114). Biggest group first, Uncategorized last. */
export function groupByCategory(items: readonly FeedItem[]): Group[] {
  const map = items.reduce((m, it) => { const k = it.ai_category ?? UNCATEGORIZED; (m.get(k) ?? m.set(k, []).get(k)!).push(it); return m; }, new Map<string, FeedItem[]>());
  return [...map].map(([name, list]) => ({ name, items: list }))
    .sort((a, b) => (a.name === UNCATEGORIZED ? 1 : b.name === UNCATEGORIZED ? -1 : b.items.length - a.items.length || a.name.localeCompare(b.name)));
}

export function filterFeed(items: readonly FeedItem[], query: string, category: string): FeedItem[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((it) => {
    if (category !== ALL && (it.ai_category ?? UNCATEGORIZED) !== category) return false;
    if (!terms.length) return true;
    const hay = `${it.title} ${hostOf(it.url)} ${it.summary_tldr ?? ''} ${it.ai_category ?? ''}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: now - Date.parse(iso) > 86400 * 330e3 ? 'numeric' : undefined });
}
