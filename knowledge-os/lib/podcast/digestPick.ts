// Pure helpers for the daily briefing (no database, no network) so they can be unit-tested.

export interface DigestRow { id: string; title: string | null; url: string | null; summary: string | null; note: string | null; content_text: string | null; created_at: string; ai_status?: string | null }

export const MIN_READABLE_CHARS = 80;
/** A 2-minute briefing is about 300 spoken words, so only a handful of items can be covered; more would be a list of names. */
export const DEFAULT_MAX_ITEMS = 6;
export const DIGEST_HOURS = 24;

export const readableText = (r: Pick<DigestRow, 'content_text' | 'summary' | 'note'>) => [r.content_text, r.summary, r.note].filter(Boolean).join('\n\n').trim();

/** Newest first; drops private saves, items with too little text, and repeat URLs (the same page saved twice). */
export function pickDigestItems(rows: DigestRow[], max = DEFAULT_MAX_ITEMS): DigestRow[] {
  const seen = new Set<string>();
  const out: DigestRow[] = [];
  for (const r of [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))) {
    if (r.ai_status === 'skipped_private') continue;
    if (readableText(r).length < MIN_READABLE_CHARS) continue;
    const key = (r.url ?? r.id).replace(/#.*$/, '').replace(/\/$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= max) break;
  }
  return out;
}

/** Stable id list: the same set of items always gives the same array, so "already made this briefing" can be an equality check. */
export const sortedIds = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

export const sinceIso = (now: Date, hours = DIGEST_HOURS) => new Date(now.getTime() - hours * 3600_000).toISOString();
