# Price-Drop Alert Engine + trust-first affiliate links

## Files
| Path | Purpose |
|---|---|
| `sql/018_price_alerts.sql` | `product_watches`, `price_observations`, `push_subscriptions`, `price_alert_log`; median, observe and atomic claim functions. Re-runnable. Run after 001. |
| `app/api/prices/observe/route.ts` + `lib/prices/observe.ts` | ingest a price report from the extension, compare with the 90-day median, claim and send alerts |
| `app/api/prices/watches/route.ts` | create / list / edit / delete watches; `?keys=1` for the extension |
| `app/api/prices/unsubscribe/route.ts` | one-click unsubscribe from the email (POST), confirm page (GET) |
| `app/api/push/subscribe/route.ts`, `public/sw-push.js` | web push registration and service worker |
| `app/api/cron/prices/route.ts` | daily prune (observations > 120 days) |
| `lib/alerts/*` | Resend email, web push (`web-push`), delivery with claim release, signed unsubscribe links |
| `lib/product.ts` | product key (`amazon.in:ASIN`, ...) derived from a URL on the server |
| `lib/affiliate.ts`, `components/deals/BuyButton.tsx`, `lib/isPro.ts` | affiliate transformer and the only component allowed to use it |
| `extension/price-capture.ts`, `price-sync.ts`, `product.ts` | price extraction and the background worker |
| `test/` | `run_sql.sh` (46 checks, PostgreSQL 16), `unit.test.ts` (76 checks) |

## How an alert is decided
1. The extension reads a price only on pages that map to a product the user is **watching** (it syncs the user's watch keys). The server also rejects reports for products the user is not watching, so this is not browsing-history collection.
2. `price_observe` stores it (30-minute throttle per product, 300 reports per user per day) and returns the **90-day median from before this price**. The median counts each observer once per day, so one person spamming a product cannot move it; fewer than 3 daily points means no median.
3. `price_claim_alerts` picks watches where price <= target, the price is at least `min_drop_pct` (default 5%) under the median (skipped without history), and the last alert is 7+ days old. It sets `last_alert_at` in the same statement, so parallel reports cannot double-alert (tested with 20 parallel callers).
4. Trust: your own browser's report is believed for your own watch. For anyone else's watch, two different users must have reported the same price (within 2%) in the last 24 hours. A single fake report cannot alert other people.
5. Email (Resend) and web push are tried; if **both** fail, the claim is released so the next report retries.

## Affiliate rules (`lib/affiliate.ts`)
- Never touches stored URLs: it returns a string at render time.
- `getMonetizedUrl(url, isProUser)` changes the URL only when `isProUser === false`. `true` and "unknown" return the original byte for byte (a failed plan lookup must never tag a paying user).
- Adds one approved parameter per merchant from `AFFILIATE_TAGS`, e.g. `{"amazon.in":{"tag":"yourid-21"},"flipkart.com":{"affid":"yourid"}}`. Existing affiliate parameters in the saved link are never replaced; lookalike hosts, http, credentials and sub-domains are never tagged.
- `BuyButton` is the only importer (a test fails otherwise, and checks that emails and push never carry tags). When a tag was added it shows "Bukmarkz earns a commission if you buy here." and `rel="sponsored"`; when not, no badge.

## Setup
- Env: `RESEND_API_KEY`, `ALERTS_FROM`, `ALERT_SIGNING_SECRET` (16+ chars; without it no email is sent, because it signs the unsubscribe link), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `AFFILIATE_TAGS`, `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`. `npm i web-push`.
- Vercel cron: `/api/cron/prices` daily.
- Extension: copy `extension/*.ts` into `src/` (shared), call `initPriceSync({ getToken, apiBase })` from `background.ts`, add `"optional_host_permissions": PRICE_HOST_PATTERNS` to the manifest and request them (`chrome.permissions.request`) when the user creates their first watch.
- Deals page: `<BuyButton url={deal.url} isPro={await getIsPro(user.id, admin)} />` (needs migration 016's `effective_plan`; without it nothing is monetized).

## Honest limits
- Not run: Next.js, Supabase, Resend, web-push, a real browser. SQL is tested on PostgreSQL 16; TypeScript is strict-checked against stubs.
- Amazon and Flipkart rarely publish prices in structured data, so the extension falls back to CSS selectors (`price-capture.ts`); those break when the sites change markup. Currency there comes from the merchant's domain.
- Crowd-sourced prices can be wrong (regional pricing, coupons, sellers). Alerts say "reported price"; the email links to the saved page so people can verify.
- Check each affiliate program's terms (disclosure wording, whether extensions or alert emails are allowed) before launch. No affiliate IDs are included.
- Not included: price history chart, server-side crawling, plan limits on the number of watches (hard cap 100 per user).
