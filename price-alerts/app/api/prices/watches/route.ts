import { admin, json, requireUser } from '@/lib/server';
import { productKeyFromUrl } from '@/lib/product';

/**
 * Price watches for the signed-in user (cookie session from the web app, or Bearer token).
 *   GET                  list watches                     GET ?keys=1   just the product keys (the extension syncs this list)
 *   POST  {item_id, target_price, currency, min_drop_pct?}   create (product_key is derived from the item's saved URL, never from the request)
 *   PATCH ?id=  {target_price?, min_drop_pct?, active?}      DELETE ?id=
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const NS = { 'cache-control': 'no-store' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://bukmarkz.com').replace(/\/$/, '');
const sameOrigin = (req: Request) => { const o = req.headers.get('origin'); return !o || o === SITE || o === new URL(req.url).origin || o.startsWith('chrome-extension://'); };
const num = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null);
const COLS = 'id,item_id,product_key,target_price,currency,min_drop_pct,active,last_alert_at,last_price,last_seen_at,created_at';

export async function GET(req: Request) {
  const user = await requireUser(req); if (!user) return json({ error: 'unauthorized' }, 401, NS);
  if (new URL(req.url).searchParams.get('keys') === '1') {
    const { data, error } = await admin.rpc('price_watch_keys', { p_user: user.id });
    return error ? json({ error: 'internal' }, 500, NS) : json({ keys: data ?? [] }, 200, NS);
  }
  const { data, error } = await admin.from('product_watches').select(COLS).eq('user_id', user.id).order('created_at', { ascending: false }).limit(100);
  return error ? json({ error: 'internal' }, 500, NS) : json({ watches: data ?? [] }, 200, NS);
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403, NS);
  const user = await requireUser(req); if (!user) return json({ error: 'unauthorized' }, 401, NS);
  const b = await req.json().catch(() => null);
  const target = num(b?.target_price, 0.01, 100_000_000), drop = b?.min_drop_pct === undefined ? 5 : num(b.min_drop_pct, 0, 90);
  const currency = typeof b?.currency === 'string' && /^[A-Za-z]{3}$/.test(b.currency) ? b.currency.toUpperCase() : null;
  if (typeof b?.item_id !== 'string' || !UUID.test(b.item_id) || target === null || drop === null || !currency) return json({ error: 'bad_input' }, 400, NS);
  const { data: item } = await admin.from('oneclist_items').select('url').eq('id', b.item_id).eq('user_id', user.id).maybeSingle();
  if (!item) return json({ error: 'item_not_found' }, 404, NS);
  const ref = productKeyFromUrl(item.url);
  if (!ref) return json({ error: 'unsupported_product', message: 'Price alerts work for product pages on Amazon, Flipkart, eBay, Walmart, Best Buy, Etsy and Target.' }, 422, NS);
  const { data, error } = await admin.from('product_watches').insert({ user_id: user.id, item_id: b.item_id, product_key: ref.key, target_price: target, currency, min_drop_pct: drop }).select(COLS).single();
  if (error) {
    if (error.code === '23505') return json({ error: 'already_watching' }, 409, NS);
    if (/too_many_watches/.test(error.message)) return json({ error: 'too_many_watches', message: 'You can watch up to 100 products.' }, 409, NS);
    if (/item_not_found/.test(error.message)) return json({ error: 'item_not_found' }, 404, NS);
    return json({ error: 'internal' }, 500, NS);
  }
  return json({ watch: data }, 201, NS);
}

export async function PATCH(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403, NS);
  const user = await requireUser(req); if (!user) return json({ error: 'unauthorized' }, 401, NS);
  const id = new URL(req.url).searchParams.get('id') ?? '';
  const b = await req.json().catch(() => null);
  if (!UUID.test(id) || !b || typeof b !== 'object') return json({ error: 'bad_input' }, 400, NS);
  const patch: Record<string, unknown> = {};
  if (b.target_price !== undefined) { const v = num(b.target_price, 0.01, 100_000_000); if (v === null) return json({ error: 'bad_input' }, 400, NS); patch.target_price = v; }
  if (b.min_drop_pct !== undefined) { const v = num(b.min_drop_pct, 0, 90); if (v === null) return json({ error: 'bad_input' }, 400, NS); patch.min_drop_pct = v; }
  if (b.active !== undefined) { if (typeof b.active !== 'boolean') return json({ error: 'bad_input' }, 400, NS); patch.active = b.active; }
  if (!Object.keys(patch).length) return json({ error: 'bad_input' }, 400, NS);
  const { data, error } = await admin.from('product_watches').update(patch).eq('id', id).eq('user_id', user.id).select(COLS).maybeSingle();
  return error ? json({ error: 'internal' }, 500, NS) : data ? json({ watch: data }, 200, NS) : json({ error: 'not_found' }, 404, NS);
}

export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403, NS);
  const user = await requireUser(req); if (!user) return json({ error: 'unauthorized' }, 401, NS);
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!UUID.test(id)) return json({ error: 'bad_input' }, 400, NS);
  const { data, error } = await admin.from('product_watches').delete().eq('id', id).eq('user_id', user.id).select('id');
  return error ? json({ error: 'internal' }, 500, NS) : data?.length ? json({ ok: true }, 200, NS) : json({ error: 'not_found' }, 404, NS);
}
