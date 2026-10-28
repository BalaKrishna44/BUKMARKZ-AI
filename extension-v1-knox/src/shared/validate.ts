import { LIMITS } from './config';
import type { SaveInput } from './types';

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

export function sanitizeSave(input: unknown): SaveInput | null {
  if (!input || typeof input !== 'object') return null;
  const i = input as Record<string, unknown>;
  if (typeof i.url !== 'string' || !isSavableUrl(i.url)) return null;
  const remind = typeof i.remindAt === 'number' && Number.isFinite(i.remindAt) ? i.remindAt : null;
  const maxAt = Date.now() + LIMITS.reminderMaxDays * 86_400_000;
  return {
    url: normalizeUrl(i.url),
    title: String(i.title ?? '').trim().slice(0, LIMITS.title),
    note: String(i.note ?? '').slice(0, LIMITS.note),
    tags: cleanTags(Array.isArray(i.tags) ? i.tags.map(String) : []),
    remindAt: remind !== null && remind > Date.now() && remind <= maxAt ? remind : null,
    private: i.private === true,
  };
}
