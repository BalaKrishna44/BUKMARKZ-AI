import { LIMITS } from './config';
import type { SaveInput, SaveKind } from './types';

/** Only http(s) pages can be bookmarked; chrome://, file:// and javascript: never. */
export function isSavableUrl(raw: string | undefined | null): raw is string {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Drop the fragment and obvious tracking parameters so the same page is not saved twice. */
export function normalizeUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|mc_eid$|ref_src$)/i.test(key)) u.searchParams.delete(key);
  }
  return u.toString();
}

export function cleanTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/^#+/, '').replace(/[^\p{L}\p{N}_ -]/gu, '').replace(/\s+/g, '-').slice(0, LIMITS.tag);
}

export function cleanTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const c = cleanTag(t);
    if (c && !out.includes(c)) out.push(c);
    if (out.length >= LIMITS.tags) break;
  }
  return out;
}

const KINDS: readonly SaveKind[] = ['page', 'selection', 'image'];

export function sanitizeSave(input: unknown): SaveInput | null {
  if (!input || typeof input !== 'object') return null;
  const i = input as Record<string, unknown>;
  if (typeof i.url !== 'string' || !isSavableUrl(i.url)) return null;
  const kind: SaveKind = KINDS.includes(i.kind as SaveKind) ? (i.kind as SaveKind) : 'page';
  // image addresses must be real http(s) URLs: data:, blob: and javascript: are refused
  let imageUrl: string | undefined;
  if (kind === 'image') {
    if (typeof i.imageUrl !== 'string' || !isSavableUrl(i.imageUrl) || i.imageUrl.length > LIMITS.imageUrl) return null;
    imageUrl = i.imageUrl;
  }
  const favicon = typeof i.favicon === 'string' && i.favicon.length <= LIMITS.faviconUrl && isSavableUrl(i.favicon) ? i.favicon : undefined;
  const description = typeof i.description === 'string' ? i.description.replace(/\s+/g, ' ').trim().slice(0, LIMITS.description) : '';
  const remind = typeof i.remindAt === 'number' && Number.isFinite(i.remindAt) ? i.remindAt : null;
  const maxAt = Date.now() + LIMITS.reminderMaxDays * 86_400_000;
  return {
    url: normalizeUrl(i.url),
    title: String(i.title ?? '').trim().slice(0, LIMITS.title),
    note: String(i.note ?? '').slice(0, kind === 'page' ? LIMITS.note : LIMITS.richNote),
    tags: cleanTags(Array.isArray(i.tags) ? i.tags.map(String) : []),
    remindAt: remind !== null && remind > Date.now() && remind <= maxAt ? remind : null,
    private: i.private === true,
    kind, ...(imageUrl ? { imageUrl } : {}), ...(favicon ? { favicon } : {}), ...(description ? { description } : {}),
  };
}
