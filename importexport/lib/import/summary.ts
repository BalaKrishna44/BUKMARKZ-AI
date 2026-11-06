import { BookmarkParser } from './parser';
import type { ParseResult } from './types';

export interface ImportPreview {
  source: string | null;                    // 'Pocket', 'Firefox', 'Pinboard'... or null when unknown
  format: ParseResult['format'];
  totalCount: number;
  categories: { name: string; count: number }[];   // top-level folder (or first tag, or 'Unsorted'), biggest first
  items: ParseResult['items'];
  skipped: ParseResult['skipped'];
  warnings: string[];
}

/** Same ceiling as POST /api/import (10 MB), so a file that previews fine is never rejected for size afterwards. */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/** Parse any supported export and shape it for the "try before you sign up" preview. Pure: works in the browser, a worker or Node. */
export function previewImport(text: string, filename?: string): ImportPreview {
  const r = new BookmarkParser().parse(text, filename);
  const counts = new Map<string, number>();                 // Map, not {}: a folder called "constructor" or "__proto__" must be a normal key
  for (const it of r.items) {
    const name = it.folder[0] || it.tags[0] || 'Unsorted';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return {
    source: r.sourceGuess, format: r.format, totalCount: r.items.length,
    categories: [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    items: r.items, skipped: r.skipped, warnings: r.warnings,
  };
}
