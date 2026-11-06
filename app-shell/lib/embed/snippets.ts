import { validSlug } from '../stacks/slug';

/**
 * Copy-paste snippets for embedding a public Live Stack. Pure and unit-tested.
 * Slugs are validated, and every user-controlled string (the stack title) is escaped for the context it lands in (HTML attribute / Markdown alt text),
 * so a stack titled `x" onload="...` or `](javascript:...)` cannot turn a snippet into something else.
 */
export type EmbedTheme = 'dark' | 'light' | 'auto';
export interface SnippetInput { slug: string; title: string; itemCount: number; site?: string; theme?: EmbedTheme; limit?: number }
const SITE = (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SITE_URL || 'https://bukmarkz.com').replace(/\/$/, '');

export const escapeHtmlAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const escapeMdText = (s: string) => s.replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}\[\]()#+!<>|]/g, (c) => '\\' + c).trim();
const cleanTitle = (t: string) => t.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Bukmarkz stack';

/** Height that shows the list without a lot of blank space: header 56px + 64px per card (max 6 visible, then it scrolls) + 44px footer badge. */
export const embedHeight = (itemCount: number, limit = 50) => 56 + 64 * Math.max(1, Math.min(6, itemCount, limit)) + 44;

export function buildSnippets(i: SnippetInput) {
  const slug = i.slug.toLowerCase();
  if (!validSlug(slug)) throw new Error('invalid slug');
  const site = (i.site ?? SITE).replace(/\/$/, ''), theme = i.theme ?? 'auto';
  const limit = Number.isInteger(i.limit) && i.limit! >= 1 && i.limit! <= 50 ? i.limit! : undefined;
  const q = new URLSearchParams(); if (theme !== 'auto') q.set('theme', theme); if (limit) q.set('limit', String(limit));
  const qs = q.toString() ? `?${q}` : '';
  const title = cleanTitle(i.title), page = `${site}/s/${slug}`, embedUrl = `${site}/embed/${slug}${qs}`, svgUrl = `${site}/embed/${slug}/card.svg${qs}`;
  const h = embedHeight(i.itemCount, limit);
  return {
    embedUrl, svgUrl, pageUrl: page, height: h,
    /** Websites, blogs, docs tools that allow iframes. `sandbox` keeps the widget from doing anything but show links and open them in a new tab. */
    iframe: `<iframe src="${escapeHtmlAttr(embedUrl)}" title="${escapeHtmlAttr(title)} (Bukmarkz stack)" width="100%" height="${h}" style="border:0;border-radius:12px;max-width:560px" loading="lazy" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="strict-origin-when-cross-origin"></iframe>`,
    /** GitHub READMEs strip iframes, so this is an IMAGE (a self-contained SVG card) wrapped in a link to the live stack. */
    markdown: `[![${escapeMdText(title)} on Bukmarkz](${svgUrl})](${page})`,
    /** Same idea as an HTML snippet, for places that accept <img> but not iframes (some READMEs, emails, wikis). */
    htmlImage: `<a href="${escapeHtmlAttr(page)}"><img src="${escapeHtmlAttr(svgUrl)}" alt="${escapeHtmlAttr(title)} on Bukmarkz" width="560"></a>`,
    /** Notion: paste this URL, choose "Create embed". */
    notion: embedUrl,
  };
}
