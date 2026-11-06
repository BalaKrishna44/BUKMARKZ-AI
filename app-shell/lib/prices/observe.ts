import { productKeyFromUrl } from '../product';
import { dispatchAlerts, type Channels, type Claim, type NotifyDb } from '../alerts/notify';

/**
 * Handles one price report from the browser extension. Pure with respect to HTTP and the database (both injected), so it is unit-tested.
 *
 *   1. authenticate (extension sends the user's Supabase access token as a Bearer token)
 *   2. validate: https product URL of a known merchant, finite positive price, ISO currency. The product key is computed HERE from the URL.
 *   3. price_observe: only for products this user is watching; throttled; returns the 90-day median from BEFORE this price
 *   4. price_claim_alerts: atomically claims every watch that qualifies (target met, drop guard, 7-day cooldown, trust rule)
 *   5. deliver by email / web push; failed deliveries release their claim
 * The response only describes the caller's own report: it never says how many OTHER people were alerted.
 */
export interface ObserveDeps {
  getUser(token: string): Promise<{ id: string } | null>;
  db: NotifyDb;
  channels: Channels;
}
export interface HandlerResult { status: number; body: Record<string, unknown> }
const MAX_BODY = 4096, MAX_PRICE = 100_000_000;

export async function handleObserve(deps: ObserveDeps, authorization: string | null, bodyText: string): Promise<HandlerResult> {
  const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? '')?.[1];
  if (!token) return { status: 401, body: { code: 'invalid_token' } };
  const user = await deps.getUser(token).catch(() => null);
  if (!user) return { status: 401, body: { code: 'invalid_token' } };

  if (bodyText.length > MAX_BODY) return { status: 413, body: { code: 'too_large' } };
  let b: any;
  try { b = JSON.parse(bodyText); } catch { return { status: 400, body: { code: 'bad_input' } }; }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { status: 400, body: { code: 'bad_input' } };
  const { url, price, currency } = b as { url?: unknown; price?: unknown; currency?: unknown };
  if (typeof url !== 'string' || url.length > 2048) return { status: 400, body: { code: 'bad_input', field: 'url' } };
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0 || price > MAX_PRICE) return { status: 400, body: { code: 'bad_input', field: 'price' } };
  if (typeof currency !== 'string' || !/^[A-Za-z]{3}$/.test(currency)) return { status: 400, body: { code: 'bad_input', field: 'currency' } };
  const ref = productKeyFromUrl(url);
  if (!ref) return { status: 422, body: { code: 'unsupported_product' } };
  const cur = currency.toUpperCase(), rounded = Math.round(price * 100) / 100;
  if (rounded <= 0) return { status: 400, body: { code: 'bad_input', field: 'price' } };

  return recordAndAlert(deps, user.id, ref.key, rounded, cur, 'extension');
}

/**
 * Record one observation for a product the user is watching, then claim and send any alerts it triggers. Shared by the extension endpoint
 * and by the server-side check (lib/prices/track.ts, source 'crawler') so both follow exactly the same rules.
 */
export async function recordAndAlert(deps: Pick<ObserveDeps, 'db' | 'channels'>, userId: string, productKey: string, rounded: number, cur: string, source: 'extension' | 'crawler'): Promise<HandlerResult> {
  const obs = await deps.db.rpc('price_observe', { p_user: userId, p_key: productKey, p_price: rounded, p_currency: cur, p_source: source });
  if (obs.error || !obs.data) { console.error('price_observe failed'); return { status: 500, body: { code: 'server' } }; }
  if (!obs.data.recorded) return { status: 200, body: { recorded: false, reason: String(obs.data.reason ?? 'ignored') } };
  const median: number | null = obs.data.median == null ? null : Number(obs.data.median);

  let alertedYou = false;
  try {
    const { data, error } = await deps.db.rpc('price_claim_alerts', { p_key: productKey, p_price: rounded, p_currency: cur, p_median: median, p_observer: userId, p_limit: 200 });
    if (error) throw new Error(error.message);
    const claims = (Array.isArray(data) ? data : []) as Claim[];
    if (claims.length) {
      const r = await dispatchAlerts(claims, rounded, median, deps.channels, deps.db);
      alertedYou = claims.some((c) => c.own) && r.sent > 0;
    }
  } catch (e) {
    console.error('alerting failed after recording', (e as Error).message);       // the observation is saved; a delivery problem must not fail the extension's request
  }
  const dropPct = median && median > 0 ? Math.round(((median - rounded) / median) * 1000) / 10 : null;
  return { status: 200, body: { recorded: true, median_90d: median, drop_pct: dropPct, alerted: alertedYou } };
}
