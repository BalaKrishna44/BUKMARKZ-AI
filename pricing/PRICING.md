# Local-currency pricing: how it fits together

**Rule:** the number a visitor sees is the number Stripe charges, in the same currency. Never convert at display time.

## Pieces
| File | Job |
|---|---|
| `pricing/currency.ts` | The price table (`PRICES`), country-to-currency (`detectCurrency`), formatting (`formatMoney`). `homepage/lib/currency.ts` is a copy; `node pricing/check-limits.mjs` fails if they differ. |
| `pricing/PricingTable.tsx` | Takes `currency` and `onCurrencyChange`. |
| `homepage/app/page.tsx` | Reads the cookie `bk_currency`, then the country header (`x-vercel-ip-country` or `cf-ipcountry`), then falls back to USD. Reading headers makes the homepage render per request instead of being a static file. |
| `homepage/lib/site-data.ts` | `PRICE` is the USD row. Structured data (JSON-LD) and the Raindrop page stay in USD on purpose. |

## Current price points (Pro monthly / Pro annual / Team per user)
USD 2 / 19 / 12.99 · EUR 2 / 19 / 11.99 · GBP 1.99 / 17 / 10.99 · INR 149 / 1,299 / 999 · CAD 2.99 / 27 / 17.99 · AUD 2.99 / 27 / 18.99 · JPY 300 / 2,800 / 1,900 · BRL 9.90 / 89 / 59.90.
**Only USD Pro ($2) was specified. Every other number is my placeholder**, chosen to be roughly in line with the dollar price; check today's exchange rates and what people in each country will pay, then edit `PRICES` in one place.

## Stripe setup (so the charge matches the display)
1. Create one Product "Bukmarkz Pro" with two recurring Prices in USD: $2.00 monthly and $19.00 yearly. Add `currency_options` on each Price for EUR, GBP, INR, CAD, AUD, JPY, BRL using the same amounts as `PRICES` (Dashboard: Price > Add currency, or the API `currency_options`). Same for Team (per seat).
2. When creating Checkout, pass `currency` from the visitor's choice (cookie), and use only currencies that the Price has. Do not let the client send an arbitrary amount.
3. Stripe Checkout also adapts the currency itself when the Price has several; still pass it explicitly so it equals what the page showed.
4. Zero-decimal currencies (JPY): Stripe amounts are whole yen, not x100.
5. Tax: show tax-inclusive prices where the law expects it (EU/UK VAT, India GST). Enable Stripe Tax or configure it yourself, and decide whether the table amounts are gross (recommended).
6. Test mode: run one test checkout per currency and compare the Checkout page total to the pricing page.

## Things to decide or check
* **Margin at $2.** Stripe fees are often about 2.9% plus 30 cents per charge in the US (varies by country), which is about 18% of a $2 payment. Your AI circuit breaker caps AI spend at 25% of plan price, which is now about $0.50 per Pro user per month, far below the 1,000 asks the plan advertises. Re-set the breaker budget or the Pro ask limit before launch.
* **In-app purchases:** if Pro is sold inside iOS or Android apps, Apple and Google set their own price tiers and take a share.
* **Old prices:** anyone who already pays $4.99 keeps `monthly_price_usd` on their subscription row; decide whether to move them to $2.
* **Do not show a crossed-out "was" price unless it is a price you really charged.**
