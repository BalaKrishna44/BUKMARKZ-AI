import { collectPageInputs, extractPrice } from './price-capture';

/**
 * Background wiring (MV3 service worker). Wire it in background.ts:   initPriceSync({ getToken, apiBase: API_BASE })
 *
 * Privacy: the worker only looks at a page when its URL maps to a product the user is WATCHING (the server returns the user's watch keys; we
 * recompute the key locally with the same rules). Nothing about other pages is read or sent.
 * Permissions: add to manifest.json  "optional_host_permissions": [ ...PRICE_HOST_PATTERNS ]  and request them when the user creates their first watch
 * (chrome.permissions.request). Without the permission the injection fails and nothing happens.
 */
import { productKeyFromUrl } from './product';

declare const chrome: any;
export interface PriceSyncOptions { getToken(): Promise<string | null>; apiBase: string }
const KEYS_ALARM = 'bukmarkz-watch-keys', KEYS_TTL_MS = 30 * 60_000;

export function initPriceSync(o: PriceSyncOptions) {
  let keys = new Set<string>(), fetchedAt = 0;
  const seen = new Map<string, number>();                                   // tab-level de-dupe: one report per product per 30 minutes (the server enforces it too)

  async function refreshKeys(force = false) {
    if (!force && Date.now() - fetchedAt < KEYS_TTL_MS) return;
    const token = await o.getToken(); if (!token) { keys = new Set(); return; }
    try {
      const r = await fetch(`${o.apiBase}/api/prices/watches?keys=1`, { credentials: 'omit', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      if (!r.ok) return;
      const b = await r.json();
      keys = new Set(Array.isArray(b.keys) ? b.keys.filter((k: unknown): k is string => typeof k === 'string') : []);
      fetchedAt = Date.now();
    } catch { /* offline: keep the old list */ }
  }

  async function onPage(tabId: number, url: string) {
    const ref = productKeyFromUrl(url); if (!ref) return;
    await refreshKeys(); if (!keys.has(ref.key)) return;
    const last = seen.get(ref.key) ?? 0; if (Date.now() - last < 30 * 60_000) return;
    let inputs;
    try { const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: collectPageInputs }); inputs = res?.result; } catch { return; }   // permission not granted / page gone
    const reading = inputs && extractPrice(inputs); if (!reading) return;
    const token = await o.getToken(); if (!token) return;
    seen.set(ref.key, Date.now());
    try { await fetch(`${o.apiBase}/api/prices/observe`, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ url, price: reading.price, currency: reading.currency }) }); }
    catch { seen.delete(ref.key); }
  }

  chrome.tabs.onUpdated.addListener((tabId: number, change: { status?: string }, tab: { url?: string }) => { if (change.status === 'complete' && tab.url) void onPage(tabId, tab.url); });
  chrome.alarms.create(KEYS_ALARM, { periodInMinutes: 30 });
  chrome.alarms.onAlarm.addListener((a: { name: string }) => { if (a.name === KEYS_ALARM) void refreshKeys(true); });
  return { refreshKeys };
}
