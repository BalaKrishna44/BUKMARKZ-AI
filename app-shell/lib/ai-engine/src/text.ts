const VAGUE = new Set(['website', 'article', 'blog', 'tutorial', 'guide', 'tips', 'resource', 'resources', 'useful', 'post', 'reel', 'video', 'instagram', 'linkedin', 'content', 'social-media']);

/** "React UI" -> "react-ui". Returns null for junk. */
export function normalizeTag(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
  if (t.length < 2 || VAGUE.has(t)) return null;
  return t;
}

export function normalizeTags(raw: unknown, max = 6): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const t = normalizeTag(item);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

export function stringList(raw: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const s = item.replace(/\s+/g, ' ').trim().slice(0, maxLen);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}
