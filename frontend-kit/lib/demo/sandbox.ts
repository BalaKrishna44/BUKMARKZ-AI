import { hostOf, type DemoLink } from './data';

/**
 * Deterministic stand-in for "Ask Your Vault" used by the landing-page sandbox and the dashboard demo.
 * It is plain keyword scoring over a tiny vault, not an AI model; the UI says so. Real searches use embeddings (match_oneclist_items).
 */
const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was', 'what', 'which', 'how', 'do', 'does', 'i', 'my', 'me', 'we', 'should', 'can', 'it', 'with', 'about', 'that', 'this', 'use', 'by', 'at', 'be']);
const SYN: Record<string, string[]> = { index: ['indexes', 'indexing', 'hnsw'], vector: ['vectors', 'embedding', 'embeddings', 'similarity', 'semantic'], rows: ['row', 'rls', 'policies', 'policy'], lock: ['security', 'restrict', 'rls'], extension: ['extensions', 'chrome', 'browser', 'manifest'], csv: ['rfc', 'format'], export: ['csv', 'format'] };

export function stem(w: string): string {
  return w.length > 4 && w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.length > 4 && w.endsWith('es') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w;
}
export function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').split(' ').filter((t) => t.length > 1 && !STOP.has(t)).map(stem);
}

export interface Hit { link: DemoLink; score: number }
export function search(query: string, vault: DemoLink[], limit = 3): Hit[] {
  const q = [...new Set(tokens(query).flatMap((t) => [t, ...(SYN[t] ?? []).map(stem)]))];
  if (!q.length) return [];
  const hits = vault.map((link) => {
    const title = new Set(tokens(link.title)), tags = new Set(link.tags.flatMap(tokens)), body = new Set(tokens(link.summary));
    let score = 0;
    for (const t of q) score += (title.has(t) ? 3 : 0) + (tags.has(t) ? 2 : 0) + (body.has(t) ? 1 : 0);
    return { link, score };
  }).filter((h) => h.score >= 2);
  return hits.sort((a, b) => b.score - a.score || a.link.title.localeCompare(b.link.title)).slice(0, limit);
}

export interface Answer { answer: string; sources: { id: string; title: string; host: string; url: string }[] }
export function answerFromVault(query: string, vault: DemoLink[]): Answer {
  const hits = search(query, vault);
  if (!hits.length) return { answer: "I couldn't find anything about that in this vault. Try a topic like vectors, row security, CSV or extensions.", sources: [] };
  const [top, ...rest] = hits;
  const lead = `From “${top.link.title}”: ${top.link.summary}`;
  const more = rest.length ? ` Also relevant: ${rest.map((h) => `“${h.link.title}”`).join(' and ')}.` : '';
  return { answer: lead + more, sources: hits.map((h) => ({ id: h.link.id, title: h.link.title, host: hostOf(h.link.url), url: h.link.url })) };
}
