import { FAQS, PRICE, SITE_NAME, SITE_URL, TRIAL_MONTHS } from '@/lib/site-data';

/* ----------------------------------------------------------------------------
   Safe script tag
   ---------------------------------------------------------------------------- */

/**
 * JSON.stringify does not escape "<", so a value containing "</script>" would end the tag early and
 * let the rest run as HTML. Replacing "<" with its unicode escape keeps the JSON identical and safe.
 * U+2028 and U+2029 are escaped for older parsers.
 */
export function serializeJsonLd(data: unknown): string {
  // Built from char codes so no invisible separator characters sit in this source file.
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  return JSON.stringify(data).replace(/</g, '\\u003c').split(LS).join('\\u2028').split(PS).join('\\u2029');
}

/** Renders one JSON-LD block. A server component: no 'use client', so the markup is in the initial HTML crawlers read. */
export function JsonLd({ data, id }: { data: Record<string, unknown>; id?: string }) {
  return <script id={id} type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}

/* ----------------------------------------------------------------------------
   What we say about ourselves.
   Only list what is true today. Google treats markup that does not match the real product as spam,
   and it can cost the whole site its rich results.
   ---------------------------------------------------------------------------- */

/** Add 'iOS', 'Android', 'Windows' or 'macOS' only once those apps are actually released. */
const OPERATING_SYSTEMS = ['Web', 'Chrome'];

const ORG_ID = `${SITE_URL}/#organization`;
const SITE_ID = `${SITE_URL}/#website`;
const APP_ID = `${SITE_URL}/#software`;

/** Add real profile URLs only (Product Hunt, X/Twitter, GitHub, LinkedIn). Leave empty until they exist. */
const SAME_AS: string[] = [];

/** Fill in from your real, visible customer reviews only; see the note at the bottom of this file. */
const AGGREGATE_RATING: { ratingValue: number; ratingCount: number } | null = null;

export function buildHomeGraph() {
  const priceSpec = (price: number, months: number) => ({
    '@type': 'UnitPriceSpecification',
    price,
    priceCurrency: 'USD',
    billingDuration: months,
    billingIncrement: 1,
    unitCode: 'MON',
  });

  const organization = {
    '@type': 'Organization',
    '@id': ORG_ID,
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    logo: { '@type': 'ImageObject', url: `${SITE_URL}/assets/icons/icon-512.png`, width: 512, height: 512 },
    ...(SAME_AS.length ? { sameAs: SAME_AS } : {}),
  };

  const website = {
    '@type': 'WebSite',
    '@id': SITE_ID,
    url: `${SITE_URL}/`,
    name: SITE_NAME,
    publisher: { '@id': ORG_ID },
    inLanguage: 'en',
    // No SearchAction: Google removed the sitelinks search box in November 2024, and Bukmarkz has no public search page.
  };

  const software = {
    '@type': 'SoftwareApplication',
    '@id': APP_ID,
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    description: 'Save links and notes in one click, set reminders, and find anything by meaning with AI search.',
    applicationCategory: 'BusinessApplication', // see the note on categories at the bottom of this file
    operatingSystem: OPERATING_SYSTEMS.join(', '),
    image: `${SITE_URL}/assets/social/og-image.png`,
    publisher: { '@id': ORG_ID },
    offers: [
      { '@type': 'Offer', name: 'Free', price: 0, priceCurrency: 'USD', url: `${SITE_URL}/#pricing`, availability: 'https://schema.org/InStock' },
      {
        '@type': 'Offer',
        name: `Pro, ${TRIAL_MONTHS}-month free trial`,
        description: `${TRIAL_MONTHS} months of Pro free. No credit card required.`,
        price: 0,
        priceCurrency: 'USD',
        eligibleDuration: { '@type': 'QuantitativeValue', value: TRIAL_MONTHS, unitCode: 'MON' },
        url: `${SITE_URL}/#pricing`,
        availability: 'https://schema.org/InStock',
      },
      {
        '@type': 'Offer',
        name: 'Pro, monthly',
        description: 'Billed monthly after the free trial.',
        price: PRICE.proMonthly,
        priceCurrency: 'USD',
        priceSpecification: priceSpec(PRICE.proMonthly, 1),
        url: `${SITE_URL}/#pricing`,
        availability: 'https://schema.org/InStock',
      },
      {
        '@type': 'Offer',
        name: 'Pro, annual',
        description: 'Billed yearly after the free trial.',
        price: PRICE.proAnnual,
        priceCurrency: 'USD',
        priceSpecification: priceSpec(PRICE.proAnnual, 12),
        url: `${SITE_URL}/#pricing`,
        availability: 'https://schema.org/InStock',
      },
    ],
    ...(AGGREGATE_RATING ? { aggregateRating: { '@type': 'AggregateRating', ...AGGREGATE_RATING } } : {}),
  };

  const faq = {
    '@type': 'FAQPage',
    '@id': `${SITE_URL}/#faq`,
    mainEntity: FAQS.filter((f) => f.inSchema).map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };

  return { '@context': 'https://schema.org', '@graph': [organization, website, software, faq] };
}

/** Drop this once on the homepage. One block holds all four entities, linked by @id. */
export default function HomeJsonLd() {
  return <JsonLd id="home-jsonld" data={buildHomeGraph()} />;
}

/* ----------------------------------------------------------------------------
   Notes

   1. Review stars. Google only shows stars for SoftwareApplication when the markup includes an
      aggregateRating or review, the reviews are real, and the reviewer-written text is visible on
      the same page. Invented ratings violate its spam policies. Until you have genuine reviews on
      the page, AGGREGATE_RATING stays null and no rating is emitted.

   2. FAQ. Google retired FAQ rich results in May 2026, so this markup will not produce an accordion
      in search results. It is still valid, and it describes the page clearly to search and AI systems.
      The page shows the same questions and answers, because markup must match visible content.

   3. applicationCategory. Google's software-app guidance lists a fixed set of categories and
      "ProductivityApplication" is not one of them. BusinessApplication is the closest. Any value is
      valid schema.org, so you can switch back with a one-line change.

   4. Sitelinks search box. Google removed it in November 2024, so there is deliberately no SearchAction.
   ---------------------------------------------------------------------------- */
