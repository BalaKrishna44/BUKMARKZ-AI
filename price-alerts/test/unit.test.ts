import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { productKeyFromUrl } from '../lib/product';
import { getMonetizedUrl, getBuyLink, parsePrograms, AFFILIATE_DISCLOSURE } from '../lib/affiliate';
import { getIsPro } from '../lib/isPro';
import { signWatch, verifyWatchToken, unsubscribeUrl } from '../lib/alerts/token';
import { buildEmail, sendEmail } from '../lib/alerts/email';
import { dispatchAlerts, type Alert, type Claim, type NotifyDb } from '../lib/alerts/notify';
import { makePush } from '../lib/alerts/push';
import { handleObserve, type ObserveDeps } from '../lib/prices/observe';
import { parsePriceString, extractFromJsonLd, extractFromMeta, extractPrice } from '../extension/price-capture';

let passed = 0, failed = 0;
const ok = (c: unknown, m: string) => { if (c) { passed++; console.log('ok   ' + m); } else { failed++; console.log('FAIL ' + m); } };
process.env.ALERT_SIGNING_SECRET = 'test-secret-0123456789';
process.env.NEXT_PUBLIC_SITE_URL = 'https://bukmarkz.com';

const claim = (o: Partial<Claim> = {}): Claim => ({ watch_id: '11111111-1111-1111-1111-111111111111', user_id: 'u1', item_id: '22222222-2222-2222-2222-222222222222', target_price: 8000, currency: 'INR', prior_alert_at: null, title: 'Noise <b>cancelling</b> headphones', url: 'https://www.amazon.in/dp/B0TESTASN1', email: 'a@x.test', own: true, ...o });

(async () => {
  // ---------- product keys ----------
  const k = (u: string) => productKeyFromUrl(u)?.key ?? null;
  ok(k('https://www.amazon.in/Some-Title/dp/b0testasn1/ref=sr_1_1?x=1') === 'amazon.in:B0TESTASN1' && k('https://amazon.com/gp/product/B0TESTASN1') === 'amazon.com:B0TESTASN1' && k('https://m.amazon.co.uk/dp/B0TESTASN1') === 'amazon.co.uk:B0TESTASN1', 'amazon: ASIN from /dp/ and /gp/product, per marketplace, tracking noise ignored');
  ok(k('https://www.flipkart.com/x/p/itm123?pid=MOBGTAGPTB3VS24W&lid=1') === 'flipkart.com:MOBGTAGPTB3VS24W', 'flipkart: pid');
  ok(k('https://www.ebay.com/itm/Cool-Thing/123456789012?hash=x') === 'ebay.com:123456789012' && k('https://www.walmart.com/ip/Thing/5555555') === 'walmart.com:5555555' && k('https://www.bestbuy.com/site/x/6428324.p?skuId=6428324') === 'bestbuy.com:6428324' && k('https://www.etsy.com/listing/1234567/thing') === 'etsy.com:1234567', 'ebay / walmart / bestbuy / etsy');
  ok(k('http://www.amazon.in/dp/B0TESTASN1') === null && k('https://amazon.in.evil.com/dp/B0TESTASN1') === null && k('https://evilamazon.in/dp/B0TESTASN1') === null && k('https://user:pw@www.amazon.in/dp/B0TESTASN1') === null && k('https://www.amazon.in:8443/dp/B0TESTASN1') === null, 'rejects http, lookalike hosts, credentials, ports');
  ok(k('https://www.amazon.in/') === null && k('https://www.amazon.in/dp/short') === null && k('not a url') === null && k('https://example.com/dp/B0TESTASN1') === null, 'rejects non-product pages, bad ASINs, unknown merchants');

  // ---------- affiliate ----------
  const programs = parsePrograms('{"amazon.in":{"tag":"bukmarkz-21"},"flipkart.com":{"affid":"bukmarkz"},"bad host":{"x":"1"},"ebay.com":{"a":"1","b":"2"},"etsy.com":{"x y":"1"}}');
  ok(programs.length === 2, 'parsePrograms: invalid hosts, multi-param and malformed entries are dropped');
  ok(parsePrograms(undefined).length === 0 && parsePrograms('not json').length === 0 && parsePrograms('[]').length === 0, 'parsePrograms: missing / broken config -> no programs (no monetization)');
  const orig = 'https://www.amazon.in/dp/B0TESTASN1?ref=x#reviews';
  ok(getMonetizedUrl(orig, true, programs) === orig, 'pro user: original URL returned unaltered');
  ok(getMonetizedUrl(orig, undefined as unknown as boolean, programs) === orig && getMonetizedUrl(orig, 'yes' as unknown as boolean, programs) === orig && getMonetizedUrl(orig, null as unknown as boolean, programs) === orig, 'unknown plan -> never monetized (only exactly false is)');
  const tagged = getMonetizedUrl(orig, false, programs);
  ok(tagged === 'https://www.amazon.in/dp/B0TESTASN1?ref=x&tag=bukmarkz-21#reviews', 'free user: approved tag appended, other params and fragment preserved');
  ok(getMonetizedUrl(tagged, false, programs) === tagged, 'idempotent');
  ok(getMonetizedUrl('https://www.amazon.in/dp/B0TESTASN1?tag=someoneelse-21', false, programs) === 'https://www.amazon.in/dp/B0TESTASN1?tag=someoneelse-21' && getMonetizedUrl('https://www.amazon.in/dp/B0TESTASN1?TAG=x', false, programs).includes('TAG=x') && !getMonetizedUrl('https://www.amazon.in/dp/B0TESTASN1?TAG=x', false, programs).includes('bukmarkz'), 'an existing affiliate parameter is never replaced');
  ok(getMonetizedUrl('https://www.flipkart.com/p?pid=ABC', false, programs).includes('affid=bukmarkz'), 'flipkart program');
  for (const u of ['https://amazon.in.evil.com/dp/B0TESTASN1', 'https://evilamazon.in/dp/x', 'https://sub.amazon.in/dp/x', 'http://www.amazon.in/dp/B0TESTASN1', 'https://user:p@www.amazon.in/dp/x', 'https://www.amazon.com/dp/B0TESTASN1', 'javascript:alert(1)', 'garbage', 'https://example.com/x'])
    ok(getMonetizedUrl(u, false, programs) === u, `not tagged: ${u.slice(0, 44)}`);
  const long = 'https://www.amazon.in/dp/B0X?q=' + 'a'.repeat(2030);
  ok(getMonetizedUrl(long, false, programs) === long, 'over-long result falls back to the original');
  const b1 = getBuyLink(orig, false, programs), b2 = getBuyLink(orig, true, programs), b3 = getBuyLink('https://example.com/x', false, programs);
  ok(b1.monetized && b1.disclosure === 'Bukmarkz earns a commission if you buy here.' && AFFILIATE_DISCLOSURE === b1.disclosure && /sponsored/.test(b1.rel), 'buy link (free): monetized, exact disclosure text, rel=sponsored');
  ok(!b2.monetized && b2.disclosure === null && b2.href === orig && !/sponsored/.test(b2.rel), 'buy link (pro): clean, no badge');
  ok(!b3.monetized && b3.disclosure === null, 'no program for the merchant -> no disclosure either (the badge appears exactly when a tag was added)');
  // the saved URL is only ever read
  const stored = Object.freeze({ url: orig }); getMonetizedUrl(stored.url, false, programs); ok(stored.url === orig, 'stored URL untouched');
  // only the Buy button may build affiliate links
  const root = join(__dirname, '..'); const files: string[] = [];
  const walk = (d: string) => { for (const n of readdirSync(d)) { if (n === 'node_modules' || n === 'test') continue; const p = join(d, n); statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) && files.push(p); } };
  walk(root);
  const users = files.filter((f) => /from ['"][^'"]*affiliate['"]/.test(readFileSync(f, 'utf8'))).map((f) => f.slice(root.length + 1));
  ok(users.length === 1 && users[0] === join('components', 'deals', 'BuyButton.tsx'), `only components/deals/BuyButton.tsx imports the affiliate module (found: ${users.join(', ')})`);
  ok(!files.some((f) => /alerts[\\/]/.test(f) && /getMonetizedUrl|getBuyLink/.test(readFileSync(f, 'utf8'))), 'alert emails and push never carry affiliate links');
  const proDb = (plan: any, error: any = null) => ({ async rpc() { return { data: plan, error }; } });
  ok((await getIsPro('u', proDb('pro'))) === true && (await getIsPro('u', proDb('team'))) === true && (await getIsPro('u', proDb('free'))) === false && (await getIsPro('u', proDb(null, { message: 'x' }))) === undefined && (await getIsPro('u', { async rpc() { throw new Error('x'); } })) === undefined, 'getIsPro: pro/team true, free false, failure -> undefined (not monetized)');

  // ---------- unsubscribe tokens ----------
  const w = claim().watch_id, t = signWatch(w);
  ok(/^[0-9a-f]{64}$/.test(t) && verifyWatchToken(w, t) && !verifyWatchToken('33333333-3333-3333-3333-333333333333', t) && !verifyWatchToken(w, t.replace(/.$/, '0')) && !verifyWatchToken(w, 'zz'), 'unsubscribe token: valid only for its own watch');
  ok(unsubscribeUrl('https://bukmarkz.com', w) === `https://bukmarkz.com/api/prices/unsubscribe?w=${w}&t=${t}`, 'unsubscribe URL shape');
  const saved = process.env.ALERT_SIGNING_SECRET; process.env.ALERT_SIGNING_SECRET = ''; ok(!verifyWatchToken(w, t), 'no signing secret -> nothing verifies'); process.env.ALERT_SIGNING_SECRET = saved;

  // ---------- email ----------
  const alert: Alert = { claim: claim(), price: 7900, medianPrice: 10000 };
  const m = buildEmail(alert);
  ok(/₹7,900/.test(m.subject) && /Noise/.test(m.subject) && /target of ₹8,000/.test(m.text) && /about ₹10,000/.test(m.text) && /7 days/.test(m.text), 'email: price, target, 90-day median, cooldown note');
  ok(!/<b>/.test(m.html) && /&lt;b&gt;cancelling/.test(m.html), 'email: product title is HTML-escaped');
  ok(m.html.includes(m.unsub.replace(/&/g, '&amp;')) && m.text.includes(m.unsub) && !/tag=|affid/.test(m.text + m.html), 'email: unsubscribe link, and never an affiliate tag');
  let sentReq: any = null; const fakeFetch = (async (url: any, init: any) => { sentReq = { url, init }; return { ok: true } as Response; }) as typeof fetch;
  process.env.RESEND_API_KEY = 're_test'; process.env.ALERTS_FROM = 'Bukmarkz <alerts@bukmarkz.com>';
  ok((await sendEmail(alert, fakeFetch)) === true && sentReq.url === 'https://api.resend.com/emails' && sentReq.init.headers.authorization === 'Bearer re_test', 'email: posts to Resend with the API key');
  const body = JSON.parse(sentReq.init.body);
  ok(body.to[0] === 'a@x.test' && /^<https:\/\/bukmarkz\.com\/api\/prices\/unsubscribe/.test(body.headers['List-Unsubscribe']) && body.headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click' && sentReq.init.headers['idempotency-key'].startsWith('price-'), 'email: List-Unsubscribe (one-click) + idempotency key');
  sentReq = null; process.env.ALERT_SIGNING_SECRET = '';
  ok((await sendEmail(alert, fakeFetch)) === false && sentReq === null, 'email: refuses to send without an unsubscribe link');
  process.env.ALERT_SIGNING_SECRET = saved; delete process.env.RESEND_API_KEY;
  ok((await sendEmail(alert, fakeFetch)) === false, 'email: no API key -> not sent (reported as failure)');

  // ---------- dispatch ----------
  const rpcLog: any[] = []; const ndb: NotifyDb = { async rpc(fn, a) { rpcLog.push({ fn, a }); return { data: null, error: null }; } };
  let r = await dispatchAlerts([claim()], 7900, 10000, { email: async () => true, push: async () => false }, ndb);
  ok(r.sent === 1 && r.released === 0 && rpcLog.find((x) => x.fn === 'price_log_alert')?.a.p_status === 'sent' && !rpcLog.some((x) => x.fn === 'price_release_claim'), 'dispatch: email alone is enough; claim kept');
  rpcLog.length = 0; r = await dispatchAlerts([claim({ prior_alert_at: '2026-10-01T00:00:00Z' })], 7900, null, { email: async () => { throw new Error('smtp down'); }, push: async () => true }, ndb);
  ok(r.sent === 1 && rpcLog.find((x) => x.fn === 'price_log_alert').a.p_channels.join() === 'push', 'dispatch: a throwing channel does not stop the other one');
  rpcLog.length = 0; r = await dispatchAlerts([claim({ prior_alert_at: '2026-10-01T00:00:00Z' })], 7900, null, { email: async () => false, push: async () => false }, ndb);
  const rel = rpcLog.find((x) => x.fn === 'price_release_claim');
  ok(r.sent === 0 && r.released === 1 && rel.a.p_prior === '2026-10-01T00:00:00Z' && rpcLog.find((x) => x.fn === 'price_log_alert').a.p_status === 'failed', 'dispatch: all channels failed -> claim released with its previous value, logged as failed');
  r = await dispatchAlerts(Array.from({ length: 30 }, (_, i) => claim({ watch_id: `w${i}` })), 1, null, { email: async () => true }, ndb);
  ok(r.sent === 30, 'dispatch: many claims');

  // ---------- push ----------
  const calls: string[] = [];
  const pdb: any = { async rpc() { return { data: null, error: null }; }, from() { const q: any = { select: () => q, eq: () => q, limit: async () => ({ data: [{ id: 's1', endpoint: 'https://p/1', p256dh: 'a'.repeat(30), auth: 'b'.repeat(20) }, { id: 's2', endpoint: 'https://p/2', p256dh: 'a'.repeat(30), auth: 'b'.repeat(20) }], error: null }), update: () => { calls.push('update'); return q; }, delete: () => { calls.push('delete'); return q; } }; return q; } };
  const push = makePush(pdb, { async send(s) { return { statusCode: s.id === 's1' ? 201 : 410 }; } });
  ok((await push(alert)) === true && calls.includes('delete') && calls.includes('update'), 'push: delivered to one device, the expired (410) subscription is deleted');
  ok((await makePush(pdb, null)(alert)) === false, 'push: not configured -> false');

  // ---------- observe handler ----------
  const mkDeps = (over: { observe?: any; claims?: any; getUser?: any } = {}) => {
    const log: any[] = []; let delivered = 0;
    const deps: ObserveDeps = {
      getUser: over.getUser ?? (async (t: string) => (t === 'good' ? { id: 'u1' } : null)),
      db: { async rpc(fn, a) { log.push({ fn, a }); if (fn === 'price_observe') return over.observe ?? { data: { recorded: true, median: 10000, points: 20 }, error: null }; if (fn === 'price_claim_alerts') return over.claims ?? { data: [claim()], error: null }; return { data: null, error: null }; } },
      channels: { email: async () => { delivered++; return true; } },
    };
    return { deps, log, delivered: () => delivered };
  };
  const post = (d: ObserveDeps, o: unknown, auth: string | null = 'Bearer good') => handleObserve(d, auth, typeof o === 'string' ? o : JSON.stringify(o));
  const good = { url: 'https://www.amazon.in/dp/B0TESTASN1', price: 7900, currency: 'inr' };
  ok((await post(mkDeps().deps, good, null)).status === 401 && (await post(mkDeps().deps, good, 'Bearer bad')).status === 401, 'observe: unauthenticated -> 401');
  ok((await post(mkDeps().deps, '{nope')).status === 400 && (await post(mkDeps().deps, '[]')).status === 400, 'observe: malformed body -> 400');
  for (const bad of [{ ...good, price: 0 }, { ...good, price: -5 }, { ...good, price: '7900' }, { ...good, price: Infinity }, { ...good, price: 1e12 }, { ...good, currency: 'RS' }, { ...good, currency: 5 }, { ...good, url: 5 }, { ...good, price: 0.001 }]) {
    const x = mkDeps(); const res = await post(x.deps, bad);
    ok(res.status === 400 && x.log.length === 0, `observe: rejects ${JSON.stringify(bad).slice(30, 80)} before touching the database`);
  }
  ok((await post(mkDeps().deps, '{"x":' + ' '.repeat(5000) + '1}')).status === 413, 'observe: oversized body -> 413');
  let x = mkDeps(); ok((await post(x.deps, { ...good, url: 'https://example.com/p/1' })).status === 422 && x.log.length === 0, 'observe: unsupported merchant -> 422');
  x = mkDeps(); ok((await post(x.deps, { ...good, product_key: 'amazon.in:HACKED' })).status === 200 && x.log[0].a.p_key === 'amazon.in:B0TESTASN1', 'observe: the product key is always computed from the URL, a client-supplied key is ignored');
  x = mkDeps(); let res = await post(x.deps, good);
  ok(x.log[0].fn === 'price_observe' && x.log[0].a.p_user === 'u1' && x.log[0].a.p_currency === 'INR' && x.log[0].a.p_source === 'extension' && x.log[0].a.p_price === 7900, 'observe: user comes from the token; currency upper-cased; source fixed to extension');
  ok(x.log[1].fn === 'price_claim_alerts' && x.log[1].a.p_median === 10000 && x.log[1].a.p_observer === 'u1', 'observe: claims use the 90-day median returned by the observation');
  ok(res.status === 200 && res.body.recorded === true && res.body.median_90d === 10000 && res.body.drop_pct === 21 && res.body.alerted === true && x.delivered() === 1, 'observe: recorded, drop vs median reported, alert delivered');
  ok(!('alerts_sent' in res.body) && !JSON.stringify(res.body).includes('a@x.test'), 'observe: the response never reveals who else was alerted');
  x = mkDeps({ observe: { data: { recorded: false, reason: 'not_watching' }, error: null } }); res = await post(x.deps, good);
  ok(res.status === 200 && res.body.recorded === false && res.body.reason === 'not_watching' && x.log.length === 1, 'observe: not watching -> nothing recorded, nothing claimed');
  x = mkDeps({ observe: { data: null, error: { message: 'db' } } }); ok((await post(x.deps, good)).status === 500, 'observe: database failure -> 500');
  x = mkDeps({ claims: { data: null, error: { message: 'claim failed' } } }); res = await post(x.deps, good);
  ok(res.status === 200 && res.body.recorded === true && res.body.alerted === false, 'observe: an alerting failure after recording does not fail the request');
  x = mkDeps({ claims: { data: [claim({ own: false })], error: null } }); res = await post(x.deps, good);
  ok(res.body.alerted === false && x.delivered() === 1, 'observe: alerts for OTHER watchers are sent but not reported as "you were alerted"');
  x = mkDeps({ observe: { data: { recorded: true, median: null }, error: null }, claims: { data: [], error: null } }); res = await post(x.deps, good);
  ok(res.body.median_90d === null && res.body.drop_pct === null && x.log[1].a.p_median === null, 'observe: no history -> null median, no drop percentage');

  // ---------- extension capture ----------
  const pp = parsePriceString;
  ok(pp('₹1,29,999.00') === 129999 && pp('$1,299.00') === 1299 && pp('1.299,00 €') === 1299 && pp('12,50') === 12.5 && pp('1 299,00') === 1299 && pp('$12') === 12 && pp('1.299.000') === 1299000 && pp('1.299') === 1299 && pp('12.5') === 12.5 && pp('€ 49,99') === 49.99, 'parsePriceString: Indian, US, EU formats');
  ok(pp('') === null && pp('Free') === null && pp('from $10 to $20') === null && pp('0') === null && pp(null) === null, 'parsePriceString: ranges, text and zero are not prices');
  const ld = JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage' }, { '@type': 'Product', name: 'x', offers: { '@type': 'Offer', price: '7,900.00', priceCurrency: 'inr' } }] });
  ok(JSON.stringify(extractFromJsonLd(['{broken', ld])) === '{"price":7900,"currency":"INR"}', 'JSON-LD: @graph Product offer, bad blocks skipped');
  ok(extractFromJsonLd([JSON.stringify({ '@type': 'Product', offers: { '@type': 'AggregateOffer', lowPrice: 49.5, priceCurrency: 'USD' } })])?.price === 49.5 && extractFromJsonLd([JSON.stringify({ '@type': 'Product', offers: [{ price: 5 }, { price: 9, priceCurrency: 'EUR' }] })])?.currency === 'EUR', 'JSON-LD: AggregateOffer and offer arrays');
  ok(extractFromJsonLd([JSON.stringify({ '@type': 'Product', offers: { price: 5 } })]) === null, 'JSON-LD: no currency -> not trusted');
  ok(JSON.stringify(extractFromMeta({ 'product:price:amount': '19.99', 'product:price:currency': 'usd' })) === '{"price":19.99,"currency":"USD"}' && extractFromMeta({ 'og:price:amount': '5' }) === null, 'meta tags: needs amount and currency');
  ok(JSON.stringify(extractPrice({ host: 'www.amazon.in', jsonLd: [], meta: {}, priceText: '₹7,900.00' })) === '{"price":7900,"currency":"INR"}' && extractPrice({ host: 'www.amazon.in', jsonLd: [], meta: {}, priceText: null }) === null && extractPrice({ host: 'shop.unknown.com', jsonLd: [], meta: {}, priceText: '$5' }) === null, 'fallback: marketplace selector text + currency from the host; unknown host -> nothing');
  console.log(`${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
