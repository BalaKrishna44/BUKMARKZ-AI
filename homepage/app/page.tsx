import type { Metadata } from 'next';
import HomeJsonLd from '@/components/JsonLd';
import HomePage from '@/components/HomePage';

// Server component: it renders the JSON-LD into the first HTML response, then hands off to the interactive client page.
export const metadata: Metadata = {
  metadataBase: new URL('https://www.bukmarkz.com'),
  title: { default: 'Bukmarkz AI | Bookmarks, Notes & Reminders', template: '%s | Bukmarkz AI' },
  description: 'Save links and notes in one click, then find them by meaning with AI search. Claim 6 months of Pro free, no credit card needed.',
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

export default function Page() {
  return (
    <>
      <HomeJsonLd />
      <HomePage />
    </>
  );
}
