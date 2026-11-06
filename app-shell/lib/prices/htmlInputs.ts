import { extractFromJsonLd, extractFromMeta, type PriceReading } from '../../extension/price-capture';

/**
 * Server-side counterpart of collectPageInputs(): turns fetched HTML into the same structured inputs, with regexes (no DOM on the server).
 * Structured data only (JSON-LD Product/Offer, og:/product: price meta, itemprop). It never reads visible price text: that is what breaks
 * when a shop changes its markup, and those shops (Amazon, Flipkart) are covered by the browser extension instead.
 */
const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)?.slice(1).find((x) => x !== undefined);
const unescape = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export function readPriceFromHtml(html: string): PriceReading | null {
  const jsonLd = [...html.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].slice(0, 20).map((m) => m[1].trim().slice(0, 500_000));
  const meta: Record<string, string> = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0], content = attr(tag, 'content');
    const k = attr(tag, 'property') ?? (attr(tag, 'itemprop') ? 'itemprop:' + attr(tag, 'itemprop') : attr(tag, 'name'));
    if (k && content && !(k in meta)) meta[k] = unescape(content).slice(0, 100);
  }
  return extractFromJsonLd(jsonLd) ?? extractFromMeta(meta);
}
