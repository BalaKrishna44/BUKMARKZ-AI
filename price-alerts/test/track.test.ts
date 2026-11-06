import { readPriceFromHtml } from '../lib/prices/htmlInputs';
import { trackPrice, type TrackDeps } from '../lib/prices/track';
import { buildShare, cleanShareUrl, dropPercent, inviteUrl } from '../lib/deals/share';

let passed = 0, failed = 0;
const ok = (c: unknown, m: string) => { if (c) { passed++; console.log('ok   ' + m); } else { failed++; console.log('FAIL ' + m); } };
const ITEM = '11111111-1111-1111-1111-111111111111', URL_ = 'https://www.ebay.com/itm/Cool-Thing/123456789012?utm_source=x';
const ld = (o: unknown) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const page = (body: string) => new TextEncoder().encode(`<html><head>${body}</head><body></body></html>`);

(async () => {
  // ---------- HTML -> price ----------
  ok(JSON.stringify(readPriceFromHtml(ld({ '@type': 'Product', offers: { '@type': 'Offer', price: '1,299.00', priceCurrency: 'inr' } }))) === '{"price":1299,"currency":"INR"}', 'json-ld Offer');
  ok(readPriceFromHtml(ld({ '@graph': [{ '@type': 'WebSite' }, { '@type': 'Product', offers: [{ price: 49.5, priceCurrency: 'USD' }] }] }))?.price === 49.5, 'json-ld @graph + offers array');
  ok(readPriceFromHtml('<meta property="og:price:amount" content="12.50"><meta property="og:price:currency" content="EUR">')?.currency === 'EUR', 'og:price meta');
  ok(readPriceFromHtml("<meta content='7.00' property='product:price:amount'><meta content='GBP' property='product:price:currency'>")?.price === 7, 'meta attribute order and quotes');
  ok(readPriceFromHtml('<script type="application/ld+json">{broken</script><p>Price: $10</p>') === null, 'broken json-ld and visible text are ignored');
  ok(readPriceFromHtml(ld({ '@type': 'Product', offers: { price: '-5', priceCurrency: 'USD' } })) === null, 'negative price rejected');

  // ---------- trackPrice ----------
  const calls: [string, any][] = [];
  const mkDb = (obs: any) => ({ async rpc(fn: string, a?: any) { calls.push([fn, a]); if (fn === 'price_observe') return { data: obs, error: null }; if (fn === 'price_claim_alerts') return { data: [], error: null }; return { data: null, error: null }; } });
  const good = (over: Partial<TrackDeps> = {}, obs: any = { recorded: true, median: 100, points: 5 }): TrackDeps => ({
    db: mkDb(obs) as any, channels: {},
    getItem: async (_u, id) => (id === ITEM ? { url: URL_ } : null),
    fetchPage: async () => ({ status: 200, contentType: 'text/html; charset=utf-8', body: page(ld({ '@type': 'Product', offers: { price: 80, priceCurrency: 'USD' } })), finalUrl: 'https://www.ebay.com/itm/Cool-Thing/123456789012' }),
    ...over });

  let r: any = await trackPrice(good(), 'u1', ITEM);
  ok(r.ok && r.price === 80 && r.currency === 'USD' && r.median90d === 100 && r.dropPct === 20, 'logs the price and reports the drop vs the 90-day median');
  const obsCall = calls.find((c) => c[0] === 'price_observe')![1];
  ok(obsCall.p_user === 'u1' && obsCall.p_key === 'ebay.com:123456789012' && obsCall.p_source === 'crawler', 'price_observe: user from caller, product key derived server-side, source crawler');
  ok((await trackPrice(good(), 'u1', 'not-a-uuid') as any).reason === 'not_found' && (await trackPrice(good(), 'u1', '22222222-2222-2222-2222-222222222222') as any).reason === 'not_found', "other people's / invalid items: not_found, no fetch");
  calls.length = 0; let fetched = 0;
  r = await trackPrice(good({ getItem: async () => ({ url: 'https://example.com/product/1' }), fetchPage: async () => { fetched++; return null; } }), 'u1', ITEM);
  ok(r.reason === 'unsupported' && fetched === 0, 'unknown merchant is never fetched');
  r = await trackPrice(good({ fetchPage: async () => { throw new Error('blocked address'); } }), 'u1', ITEM); ok(r.reason === 'fetch_failed', 'SSRF block / network error -> fetch_failed');
  r = await trackPrice(good({ fetchPage: async () => ({ status: 503, contentType: 'text/html', body: page(''), finalUrl: URL_ }) }), 'u1', ITEM); ok(r.reason === 'fetch_failed', 'non-2xx -> fetch_failed');
  r = await trackPrice(good({ fetchPage: async () => ({ status: 200, contentType: 'application/json', body: page(''), finalUrl: URL_ }) }), 'u1', ITEM); ok(r.reason === 'fetch_failed', 'non-HTML -> fetch_failed');
  r = await trackPrice(good({ fetchPage: async () => ({ status: 200, contentType: 'text/html', body: page(ld({ '@type': 'Product', offers: { price: 1, priceCurrency: 'USD' } })), finalUrl: 'https://www.ebay.com/itm/999999999999' }) }), 'u1', ITEM);
  ok(r.reason === 'redirected', 'redirect to a different product is discarded');
  r = await trackPrice(good({ fetchPage: async () => ({ status: 200, contentType: 'text/html', body: page('<title>Sign in</title>'), finalUrl: 'https://www.ebay.com/itm/123456789012' }) }), 'u1', ITEM); ok(r.reason === 'no_price_found', 'no structured price -> no_price_found (use the extension)');
  ok((await trackPrice(good({}, { recorded: false, reason: 'not_watching' }), 'u1', ITEM) as any).reason === 'needs_watch', 'not watching -> needs_watch');
  ok((await trackPrice(good({}, { recorded: false, reason: 'throttled' }), 'u1', ITEM) as any).reason === 'throttled', 'throttled passes through');
  ok((await trackPrice(good({ db: { async rpc() { return { data: null, error: { message: 'x' } }; } } as any }), 'u1', ITEM) as any).reason === 'server', 'database error -> server (no details)');

  // ---------- share ----------
  ok(dropPercent(80, 100) === 20 && dropPercent(100, 100) === 0 && dropPercent(120, 100) === 0 && dropPercent(0, 100) === 0, 'drop percent');
  ok(cleanShareUrl('https://x.com/p?id=1&utm_source=a&fbclid=z&tag=other-21#frag') === 'https://x.com/p?id=1&tag=other-21', 'tracking params stripped; other parameters (even someone elses tag) untouched');
  ok(cleanShareUrl('http://x.com/p') === null && cleanShareUrl('javascript:alert(1)') === null && cleanShareUrl('https://u:p@x.com/') === null, 'only plain https');
  ok(inviteUrl('abcd2345', 'https://b.com') === 'https://b.com/?ref=abcd2345' && inviteUrl('BAD CODE') === null && inviteUrl(null) === null, 'invite link only for a valid code');
  const s = buildShare({ title: 'Cool  Thing', url: URL_, price: 80, was: 100, currency: 'USD', refCode: 'abcd2345', site: 'https://bukmarkz.com' })!;
  ok(s.text.includes('dropped 20%') && s.text.includes('$80') && s.text.includes('(was $100)') && s.text.includes('ref=abcd2345') && !s.text.includes('utm_'), 'share text: drop, prices, invite, clean link');
  ok(s.whatsapp.startsWith('https://wa.me/?text=') && decodeURIComponent(s.whatsapp.slice(20)) === s.text, 'whatsapp link round-trips the text');
  ok(s.telegram.startsWith('https://t.me/share/url?url=') && s.telegram.includes(encodeURIComponent(s.link)), 'telegram link');
  ok(buildShare({ title: 'x', url: 'http://bad', price: 1, was: 2, currency: 'USD' }) === null, 'bad url -> no share');
  ok(!/affiliate|getMonetized|getBuyLink/.test(require('node:fs').readFileSync(__dirname + '/../lib/deals/share.ts', 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), 'share code never uses the affiliate module');
  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
