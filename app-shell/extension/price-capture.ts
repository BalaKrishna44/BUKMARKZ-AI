/**
 * Price extraction for the extension. Pure functions over text the page gave us (JSON-LD blocks, <meta> values, one price string),
 * so they are unit-tested without a browser. Prefers structured data (explicit currency); falls back to a marketplace selector with the
 * currency taken from the merchant's host, never guessed from a symbol alone.
 */
export interface PriceReading { price: number; currency: string }
export interface PageInputs { host: string; jsonLd: string[]; meta: Record<string, string>; priceText: string | null }

/** "1,299.00" "1.299,00" "₹1,29,999" "1 299,00 €" "$12" -> number. null when it does not look like exactly one price. */
export function parsePriceString(raw: string | null | undefined): number | null {
  if (!raw || /^\s*[-−–]/.test(raw)) return null;                           // a negative amount is never a price (and the sign must not be silently dropped)
  const m = raw.match(/\d[\d.,\u00a0\u202f ]*\d|\d/g);
  if (!m || m.length !== 1) return null;                                    // "from 10 to 20", or no number
  let t = m[0].replace(/[ \u00a0\u202f]/g, '');
  const lastDot = t.lastIndexOf('.'), lastComma = t.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {                                      // both present: the later one is the decimal separator
    t = lastDot > lastComma ? t.replace(/,/g, '') : t.replace(/\./g, '').replace(',', '.');
  } else if (lastComma >= 0) {
    t = /,\d{1,2}$/.test(t) && t.indexOf(',') === lastComma ? t.replace(',', '.') : t.replace(/,/g, '');   // "12,50" decimal; "1,299" / "1,29,999" thousands
  } else if (lastDot >= 0) {
    t = /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t;                                        // "1.299" / "1.299.000" are thousands (no merchant shows 3 decimals)
  }
  const n = Number(t);
  return Number.isFinite(n) && n > 0 && n <= 100_000_000 ? Math.round(n * 100) / 100 : null;
}

const CUR = /^[A-Za-z]{3}$/;
function fromOffer(o: any): PriceReading | null {
  if (!o || typeof o !== 'object') return null;
  if (Array.isArray(o)) { for (const x of o) { const r = fromOffer(x); if (r) return r; } return null; }
  const cur = o.priceCurrency ?? o.priceSpecification?.priceCurrency;
  const val = o.price ?? o.lowPrice ?? o.priceSpecification?.price;
  const price = typeof val === 'number' ? (val > 0 && val <= 100_000_000 ? val : null) : parsePriceString(typeof val === 'string' ? val : null);
  return price && typeof cur === 'string' && CUR.test(cur) ? { price: Math.round(price * 100) / 100, currency: cur.toUpperCase() } : fromOffer(o.offers);
}
function findProduct(node: any, depth = 0): PriceReading | null {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findProduct(n, depth + 1); if (r) return r; } return null; }
  const t = node['@type'];
  if ((Array.isArray(t) ? t : [t]).some((x) => x === 'Product' || x === 'ProductGroup')) { const r = fromOffer(node.offers); if (r) return r; }
  return findProduct(node['@graph'], depth + 1);
}
export function extractFromJsonLd(blocks: string[]): PriceReading | null {
  for (const b of blocks.slice(0, 20)) {
    if (b.length > 500_000) continue;
    try { const r = findProduct(JSON.parse(b)); if (r) return r; } catch { /* invalid JSON-LD is common */ }
  }
  return null;
}
export function extractFromMeta(meta: Record<string, string>): PriceReading | null {
  const amount = meta['product:price:amount'] ?? meta['og:price:amount'] ?? meta['itemprop:price'];
  const cur = meta['product:price:currency'] ?? meta['og:price:currency'] ?? meta['itemprop:priceCurrency'];
  const price = parsePriceString(amount);
  return price && cur && CUR.test(cur) ? { price, currency: cur.toUpperCase() } : null;
}

const HOST_CURRENCY: Record<string, string> = {
  'amazon.in': 'INR', 'flipkart.com': 'INR', 'amazon.com': 'USD', 'walmart.com': 'USD', 'bestbuy.com': 'USD', 'target.com': 'USD', 'amazon.co.uk': 'GBP',
  'amazon.de': 'EUR', 'amazon.fr': 'EUR', 'amazon.it': 'EUR', 'amazon.es': 'EUR', 'amazon.nl': 'EUR', 'amazon.ca': 'CAD', 'amazon.com.au': 'AUD', 'amazon.co.jp': 'JPY',
};
export function extractPrice(i: PageInputs): PriceReading | null {
  const structured = extractFromJsonLd(i.jsonLd) ?? extractFromMeta(i.meta);
  if (structured) return structured;
  const host = i.host.toLowerCase().replace(/^(?:www|m)\./, '');
  const cur = HOST_CURRENCY[host], price = parsePriceString(i.priceText);
  return cur && price ? { price, currency: cur } : null;
}

/** Runs INSIDE the page (chrome.scripting.executeScript): must stay self-contained. Collects text only; parsing happens in the extension. */
export function collectPageInputs(): PageInputs {
  const meta: Record<string, string> = {};
  document.querySelectorAll('meta[property], meta[itemprop], meta[name]').forEach((m) => {
    const k = m.getAttribute('property') ?? (m.getAttribute('itemprop') ? 'itemprop:' + m.getAttribute('itemprop') : m.getAttribute('name'));
    const v = m.getAttribute('content');
    if (k && v && !(k in meta)) meta[k] = v.slice(0, 100);
  });
  const sel = ['span.a-price span.a-offscreen', '#corePrice_feature_div .a-offscreen', 'div._30jeq3', 'div.Nx9bqj'];       // Amazon, Flipkart: fragile, update when markup changes
  let priceText: string | null = null;
  for (const s of sel) { const t = document.querySelector(s)?.textContent; if (t) { priceText = t.slice(0, 40); break; } }
  return { host: location.hostname, jsonLd: Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map((s) => (s.textContent ?? '').slice(0, 500_000)), meta, priceText };
}
