import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LOCALE_META, isLocale, locales } from '@/i18n';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { getDictionary } from '@/lib/dictionaries';

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

// Next 15: params is a Promise. (Next 14: params is a plain object; `await` on it still works, only the type differs.)
type Props = { children: React.ReactNode; params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Pick<Props, 'params'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = await getDictionary(locale);
  return {
    title: t.meta.title,
    description: t.meta.description,
    // hreflang tells Google every language version of the page exists, so it doesn't treat them as duplicates.
    alternates: { languages: Object.fromEntries(locales.map((l) => [l, `/${l}`])) },
  };
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();           // /xx/anything -> 404
  const t = await getDictionary(locale);
  return (
    <html lang={locale} dir={LOCALE_META[locale].dir}>
      <body>
        <header className="flex items-center justify-between px-4 py-3 sm:px-6">
          <a href={`/${locale}`} className="font-bold">Bukmarkz</a>
          <nav className="flex items-center gap-4" aria-label={t.nav.label}>
            <a href={`/${locale}/dashboard`}>{t.nav.dashboard}</a>
            <LanguageSwitcher current={locale} />
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
