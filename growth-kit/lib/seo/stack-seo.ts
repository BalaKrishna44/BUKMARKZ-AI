/** SEO rules for public Stacks. Pure functions so the indexing policy is testable. */
export interface PublicStack {
  slug: string; title: string; description: string | null; theme?: string; handle: string;
  updated_at?: string; follower_count?: number; remix_count?: number;
  items: { title: string; url: string; blurb?: string | null }[];
}
export const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://bukmarkz.com').replace(/\/$/, '');
/** A thin page hurts the whole site. Index only stacks with enough real content. */
export const MIN_ITEMS_TO_INDEX = 3;

export const isIndexable = (s: PublicStack | null | undefined): boolean =>
  !!s && s.items.length >= MIN_ITEMS_TO_INDEX && s.title.trim().length >= 3 && s.items.every((i) => /^https?:\/\//.test(i.url));

const clip = (t: string, n: number) => { const x = t.replace(/\s+/g, ' ').trim(); return x.length <= n ? x : x.slice(0, n - 1).trimEnd() + '…'; };

export function stackDescription(s: PublicStack): string {
  const base = s.description?.trim() || `${s.items.length} hand-picked links by @${s.handle}: ${s.items.slice(0, 3).map((i) => i.title).join(', ')}.`;
  return clip(`${base} Follow or remix this Stack on Bukmarkz.`, 160);
}
export function stackMetadata(s: PublicStack | null) {
  if (!s) return { title: 'Stack not found', robots: { index: false, follow: false } };
  const url = `${SITE}/s/${s.slug}`;
  const index = isIndexable(s);
  return {
    title: clip(`${s.title} (${s.items.length} links) by @${s.handle}`, 70),
    description: stackDescription(s),
    alternates: { canonical: url },
    robots: index ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { type: 'website', url, title: clip(s.title, 70), description: stackDescription(s), siteName: 'Bukmarkz' },
    twitter: { card: 'summary_large_image', title: clip(s.title, 70), description: stackDescription(s) },
  };
}
/** User-submitted outbound links: tell search engines we do not vouch for them (anti-spam), and stop referrer/opener leaks. */
export const STACK_LINK_REL = 'ugc nofollow noopener noreferrer';

/** schema.org ItemList for rich results. Content must match what is visible on the page. */
export function stackJsonLd(s: PublicStack) {
  return {
    '@context': 'https://schema.org', '@type': 'ItemList', name: s.title, url: `${SITE}/s/${s.slug}`,
    numberOfItems: s.items.length,
    itemListElement: s.items.map((i, k) => ({ '@type': 'ListItem', position: k + 1, name: i.title, url: i.url })),
  };
}
/** JSON inside <script> must not be able to close the tag. */
export const safeJson = (o: unknown) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, '');

export interface SitemapRow { slug: string; updated_at: string }
export function sitemapEntries(rows: SitemapRow[]) {
  return rows.filter((r) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(r.slug)).map((r) => ({
    url: `${SITE}/s/${r.slug}`, lastModified: new Date(r.updated_at), changeFrequency: 'weekly' as const, priority: 0.6,
  }));
}
/** OG image text: bounded so a long title cannot overflow the card. */
export function ogText(s: PublicStack) {
  return { title: clip(s.title, 60), by: `@${s.handle}`, count: `${s.items.length} link${s.items.length === 1 ? '' : 's'}`, preview: s.items.slice(0, 3).map((i) => clip(i.title, 48)) };
}
