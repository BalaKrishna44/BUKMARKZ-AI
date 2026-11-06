// i18n.ts — single source of truth for locales, detection and path helpers. Pure functions: safe in Edge middleware, server and client.

export const locales = ['en', 'es', 'de', 'ja', 'hi'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';
export const LOCALE_COOKIE = 'NEXT_LOCALE';
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year, in seconds

export const LOCALE_META: Record<Locale, { label: string; native: string; flag: string; dir: 'ltr' | 'rtl' }> = {
  en: { label: 'English', native: 'English', flag: '🇬🇧', dir: 'ltr' },
  es: { label: 'Spanish', native: 'Español', flag: '🇪🇸', dir: 'ltr' },
  de: { label: 'German', native: 'Deutsch', flag: '🇩🇪', dir: 'ltr' },
  ja: { label: 'Japanese', native: '日本語', flag: '🇯🇵', dir: 'ltr' },
  hi: { label: 'Hindi', native: 'हिन्दी', flag: '🇮🇳', dir: 'ltr' },
};

/** Country (ISO 3166-1 alpha-2) -> default language. Only used when the browser gives no usable Accept-Language.
 *  IN is deliberately 'en': most Indian web users browse in English; people who want Hindi get it from their browser setting or the switcher. */
export const COUNTRY_TO_LOCALE: Record<string, Locale> = {
  DE: 'de', AT: 'de', CH: 'de', LI: 'de',
  ES: 'es', MX: 'es', AR: 'es', CO: 'es', CL: 'es', PE: 'es', VE: 'es', EC: 'es', UY: 'es', PY: 'es', BO: 'es', CR: 'es', PA: 'es', DO: 'es', GT: 'es', HN: 'es', NI: 'es', SV: 'es', CU: 'es',
  JP: 'ja',
  IN: 'en',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

/** Highest-priority supported language from an Accept-Language header ("hi-IN,hi;q=0.9,en;q=0.8"). Returns null if none is supported. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .slice(0, 512)
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const weight = q ? Number.parseFloat(q.slice(2)) : 1;
      return { primary: tag.trim().toLowerCase().split('-')[0], weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((x) => x.primary && x.primary !== '*' && x.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const { primary } of ranked) if (isLocale(primary)) return primary;
  return null;
}

export function localeFromCountry(country: string | null | undefined): Locale | null {
  if (!country) return null;
  return COUNTRY_TO_LOCALE[country.trim().toUpperCase()] ?? null;
}

export interface DetectInput {
  cookie?: string | null;
  acceptLanguage?: string | null;
  country?: string | null;
}

/** Priority: 1) the user's saved choice (cookie)  2) the browser's language  3) the visitor's country  4) default. */
export function resolveLocale({ cookie, acceptLanguage, country }: DetectInput): Locale {
  if (isLocale(cookie)) return cookie;
  return localeFromAcceptLanguage(acceptLanguage) ?? localeFromCountry(country) ?? defaultLocale;
}

/** "/de/dashboard" -> { locale: 'de', rest: '/dashboard' };  "/dashboard" -> { locale: null, rest: '/dashboard' } */
export function splitLocale(pathname: string): { locale: Locale | null; rest: string } {
  const m = /^\/([^/]+)(\/.*)?$/.exec(pathname);
  if (m && isLocale(m[1])) return { locale: m[1], rest: m[2] || '/' };
  return { locale: null, rest: pathname || '/' };
}

/** Put a locale in front of a path, replacing any locale already there. "/dashboard" + "de" -> "/de/dashboard"; "/" + "de" -> "/de". */
export function withLocale(pathname: string, locale: Locale): string {
  const { rest } = splitLocale(pathname);
  return rest === '/' ? `/${locale}` : `/${locale}${rest}`;
}
