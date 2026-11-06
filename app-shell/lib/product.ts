/**
 * Product identity from a URL: "<merchant>:<sku>". Derived on the SERVER from the URL (never accepted from a client), so a watch and an
 * observation can only ever meet on a key we computed ourselves. Only https product pages of known merchants; anything else is null.
 */
export interface ProductRef { key: string; merchant: string; sku: string }

const AMAZON_HOSTS = /^(?:www\.)?amazon\.(com|in|co\.uk|de|fr|it|es|ca|com\.au|co\.jp|com\.mx|com\.br|nl|se|pl|sg|ae|sa|com\.tr|eg)$/i;

export function productKeyFromUrl(raw: string): ProductRef | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase().replace(/^(?:m|mobile)\./, '');
  const path = u.pathname;
  const mk = (merchant: string, sku: string): ProductRef => ({ key: `${merchant}:${sku}`, merchant, sku });

  const am = AMAZON_HOSTS.exec(host);
  if (am) {
    const m = /\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/asin)\/([A-Za-z0-9]{10})(?:[/?]|$)/.exec(path);
    return m ? mk(`amazon.${am[1].toLowerCase()}`, m[1].toUpperCase()) : null;
  }
  if (/^(?:www\.)?flipkart\.com$/.test(host)) {
    const pid = u.searchParams.get('pid');
    return pid && /^[A-Za-z0-9]{12,20}$/.test(pid) ? mk('flipkart.com', pid.toUpperCase()) : null;
  }
  const eb = /^(?:www\.)?ebay\.(com|co\.uk|de|fr|it|es|ca|com\.au|in)$/.exec(host);
  if (eb) { const m = /\/itm\/(?:[^/]+\/)?(\d{9,14})(?:[/?]|$)/.exec(path); return m ? mk(`ebay.${eb[1]}`, m[1]) : null; }
  if (/^(?:www\.)?walmart\.com$/.test(host)) { const m = /\/ip\/(?:[^/]+\/)?(\d{6,12})(?:[/?]|$)/.exec(path); return m ? mk('walmart.com', m[1]) : null; }
  if (/^(?:www\.)?bestbuy\.com$/.test(host)) {
    const sku = u.searchParams.get('skuId') ?? /\/(\d{7})\.p(?:[/?]|$)/.exec(path)?.[1];
    return sku && /^\d{7}$/.test(sku) ? mk('bestbuy.com', sku) : null;
  }
  if (/^(?:www\.)?etsy\.com$/.test(host)) { const m = /\/listing\/(\d{6,12})(?:[/?]|$)/.exec(path); return m ? mk('etsy.com', m[1]) : null; }
  if (/^(?:www\.)?target\.com$/.test(host)) { const m = /\/p\/(?:[^/]+\/)?-?\/?A-(\d{6,10})(?:[/?]|$)/.exec(path); return m ? mk('target.com', m[1]) : null; }
  return null;
}

/** Hosts the extension may read prices on (used for the manifest's optional host permissions and the content-script gate). */
export const PRICE_HOST_PATTERNS = [
  'https://*.amazon.com/*', 'https://*.amazon.in/*', 'https://*.amazon.co.uk/*', 'https://*.amazon.de/*', 'https://*.amazon.ca/*',
  'https://*.flipkart.com/*', 'https://*.ebay.com/*', 'https://*.walmart.com/*', 'https://*.bestbuy.com/*', 'https://*.etsy.com/*', 'https://*.target.com/*',
];
