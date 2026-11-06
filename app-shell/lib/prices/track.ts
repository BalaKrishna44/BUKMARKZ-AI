import { productKeyFromUrl } from '../product';
import { recordAndAlert, type ObserveDeps } from './observe';
import { readPriceFromHtml } from './htmlInputs';

/**
 * "Check the price of this saved product now" (server-side, on demand, for ONE of the caller's own saved links).
 * Pure with respect to the framework: the page fetch, the item lookup and the database are injected, so it is unit-tested.
 *
 *  - Only products of known merchants (productKeyFromUrl) and only when the user already watches the product (price_observe enforces it).
 *  - The fetch is SSRF-safe and bounded (see app/actions/trackPrice.ts). If the page redirects somewhere that is not the SAME product, the result is discarded.
 *  - Only structured price data is read. No CAPTCHA handling and no evasion: if a shop blocks us, the answer is "use the extension", not a workaround.
 *  - The price goes through the same price_observe / price_claim_alerts path as the extension (source 'crawler'), so thresholds, medians,
 *    cooldowns and the trust rule are identical. It is stored in price_observations (this kit's price history table).
 */
export type TrackResult =
  | { ok: true; price: number; currency: string; median90d: number | null; dropPct: number | null; alerted: boolean }
  | { ok: false; reason: 'not_found' | 'unsupported' | 'fetch_failed' | 'redirected' | 'no_price_found' | 'needs_watch' | 'throttled' | 'rate_limited' | 'server' };

export interface TrackDeps extends Pick<ObserveDeps, 'db' | 'channels'> {
  getItem(userId: string, itemId: string): Promise<{ url: string } | null>;                        // must run under the user's own RLS
  fetchPage(url: string): Promise<{ status: number; contentType: string; body: Uint8Array; finalUrl: string } | null>;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function trackPrice(deps: TrackDeps, userId: string, itemId: string): Promise<TrackResult> {
  if (!UUID.test(itemId)) return { ok: false, reason: 'not_found' };
  const item = await deps.getItem(userId, itemId);
  if (!item) return { ok: false, reason: 'not_found' };
  const ref = productKeyFromUrl(item.url);
  if (!ref) return { ok: false, reason: 'unsupported' };

  let page: Awaited<ReturnType<TrackDeps['fetchPage']>>;
  try { page = await deps.fetchPage(item.url); } catch { page = null; }
  if (!page || page.status < 200 || page.status >= 300 || !/^(text\/html|application\/xhtml\+xml)\b/i.test(page.contentType)) return { ok: false, reason: 'fetch_failed' };
  if (productKeyFromUrl(page.finalUrl)?.key !== ref.key) return { ok: false, reason: 'redirected' };       // sent to a login wall, a captcha page or another product

  const reading = readPriceFromHtml(new TextDecoder('utf-8', { fatal: false }).decode(page.body));
  if (!reading) return { ok: false, reason: 'no_price_found' };

  const r = await recordAndAlert(deps, userId, ref.key, Math.round(reading.price * 100) / 100, reading.currency, 'crawler');
  if (r.status !== 200) return { ok: false, reason: 'server' };
  if (r.body.recorded !== true) {
    const why = String(r.body.reason ?? '');
    return { ok: false, reason: why === 'not_watching' ? 'needs_watch' : why === 'throttled' ? 'throttled' : why === 'rate_limited' ? 'rate_limited' : 'server' };
  }
  return { ok: true, price: Math.round(reading.price * 100) / 100, currency: reading.currency, median90d: (r.body.median_90d as number | null) ?? null, dropPct: (r.body.drop_pct as number | null) ?? null, alerted: r.body.alerted === true };
}
