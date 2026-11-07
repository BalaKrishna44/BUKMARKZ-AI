import type { Metadata } from 'next';
import HomeJsonLd from '@/components/JsonLd';
import Landing from '@/components/landing/Landing';
import { cookies, headers } from 'next/headers';
import { CURRENCY_COOKIE, detectCurrency } from '@/lib/currency';

// Server component: it renders the JSON-LD into the first HTML response, then hands off to the interactive client page.
export const metadata: Metadata = {
  metadataBase: new URL('https://www.bukmarkz.com'),
  title: { default: 'Bukmarkz | AI Bookmark Manager & Second Brain', template: '%s | Bukmarkz AI' },
  description: 'Bukmarkz is an AI bookmark manager. Save links and notes in one click, auto-file them, and find anything by meaning. 6 months of Pro free, no credit card.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Bukmarkz AI: Save it once. Find it by meaning.',
    description: 'Claim 6 months of Pro free. Save from Chrome in one click.',
    url: '/',
    siteName: 'Bukmarkz AI',
    images: [{ url: '/assets/social/og-image.png', width: 1200, height: 630, alt: 'Bukmarkz AI logo with the tagline "Save it once. Find it by meaning."' }],
    locale: 'en_US',
    type: 'website',
  },
  twitter: { card: 'summary_large_image', title: 'Bukmarkz AI: Save it once. Find it by meaning.', description: 'Bookmarks, notes and reminders with AI search. 6 months of Pro free.', images: ['/assets/social/twitter-card.png'] },
};

export default async function Page() {
  // Country header: Vercel sets x-vercel-ip-country, Cloudflare sets cf-ipcountry. Reading it makes this page render per request (not static).
  const [h, c] = await Promise.all([headers(), cookies()]);
  const currency = detectCurrency({ cookie: c.get(CURRENCY_COOKIE)?.value, country: h.get('x-vercel-ip-country') ?? h.get('cf-ipcountry') });
  return (
    <>
      <HomeJsonLd />
      <Landing currency={currency} />
    </>
  );
}
