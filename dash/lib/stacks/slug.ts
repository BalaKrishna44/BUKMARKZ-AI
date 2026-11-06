export const RESERVED = new Set(['new', 'edit', 'fork', 'api', 'admin', 'www', 'app', 'login', 'logout', 'signup', 'dashboard', 'settings', 'explore', 'search', 'bukmarkz', 'support', 'help', 'about', 'terms', 'privacy', 'null', 'undefined']);
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

/** "Best AI Tools for Devs (2026)!" -> "best-ai-tools-for-devs-2026". Accents folded; non-Latin titles fall back to ''. */
export function slugify(title: string, max = 48): string {
  const s = title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/g, '');
  return s;
}
export const validSlug = (s: string) => s.length >= 3 && s.length <= 60 && SLUG_RE.test(s) && !RESERVED.has(s);
/** Base slug for a title, or a random fallback ("stack-x7k2q") when the title has no Latin letters/digits. */
export function baseSlug(title: string, rand: () => string = () => Math.random().toString(36).slice(2, 7)): string {
  const s = slugify(title);
  return validSlug(s) ? s : `stack-${rand()}`;
}
export const withSuffix = (base: string, rand: () => string = () => Math.random().toString(36).slice(2, 6)) => `${base.slice(0, 55).replace(/-+$/, '')}-${rand()}`;
