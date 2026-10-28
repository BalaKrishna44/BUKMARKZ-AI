import { notFound } from 'next/navigation';
import { isLocale } from '@/i18n';
import { getDictionary } from '@/lib/dictionaries';

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getDictionary(locale);
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 text-center">
      <h1 className="text-4xl font-bold">{t.home.title}</h1>
      <p className="mt-4 text-lg">{t.home.subtitle}</p>
    </main>
  );
}
