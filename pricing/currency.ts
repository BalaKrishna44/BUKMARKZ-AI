/**
 * One table of LOCAL price points. A visitor sees the price in their own currency, and that exact amount is what Stripe charges:
 * create one Stripe Price per plan with `currency_options` for each currency below (see PRICING.md), never convert at display time.
 * ALL NUMBERS EXCEPT USD ARE PLACEHOLDERS that you should set deliberately (exchange rates move; local buying power differs).
 * Prices are what the customer pays: in the EU, UK and India they must include VAT/GST, so set them as final tax-inclusive amounts.
 */
export type CurrencyCode = 'USD' | 'EUR' | 'GBP' | 'INR' | 'CAD' | 'AUD' | 'JPY' | 'BRL';
export interface PricePoints { proMonthly: number; proAnnual: number; teamMonthly: number }

export const PRICES: Record<CurrencyCode, PricePoints> = {
  USD: { proMonthly: 2,    proAnnual: 19,   teamMonthly: 12.99 },
  EUR: { proMonthly: 2,    proAnnual: 19,   teamMonthly: 11.99 },
  GBP: { proMonthly: 1.99, proAnnual: 17,   teamMonthly: 10.99 },
  INR: { proMonthly: 149,  proAnnual: 1299, teamMonthly: 999 },
  CAD: { proMonthly: 2.99, proAnnual: 27,   teamMonthly: 17.99 },
  AUD: { proMonthly: 2.99, proAnnual: 27,   teamMonthly: 18.99 },
  JPY: { proMonthly: 300,  proAnnual: 2800, teamMonthly: 1900 },
  BRL: { proMonthly: 9.9,  proAnnual: 89,   teamMonthly: 59.9 },
};
export const CURRENCIES = Object.keys(PRICES) as CurrencyCode[];
export const DEFAULT_CURRENCY: CurrencyCode = 'USD';
export const CURRENCY_COOKIE = 'bk_currency';

const LOCALE: Record<CurrencyCode, string> = { USD: 'en-US', EUR: 'en-IE', GBP: 'en-GB', INR: 'en-IN', CAD: 'en-US', AUD: 'en-US', JPY: 'en-US', BRL: 'pt-BR' };
export const CURRENCY_NAME: Record<CurrencyCode, string> = {
  USD: 'US dollar (USD)', EUR: 'Euro (EUR)', GBP: 'British pound (GBP)', INR: 'Indian rupee (INR)', CAD: 'Canadian dollar (CAD)', AUD: 'Australian dollar (AUD)', JPY: 'Japanese yen (JPY)', BRL: 'Brazilian real (BRL)',
};

const EURO = new Set(['AT', 'BE', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES']);
const BY_COUNTRY: Record<string, CurrencyCode> = { US: 'USD', GB: 'GBP', IN: 'INR', CA: 'CAD', AU: 'AUD', JP: 'JPY', BR: 'BRL' };

export const isCurrency = (v: unknown): v is CurrencyCode => typeof v === 'string' && Object.prototype.hasOwnProperty.call(PRICES, v);

/** The visitor's explicit choice (cookie) wins; otherwise their country; otherwise USD. Country comes from your host's header
 *  (Vercel: x-vercel-ip-country, Cloudflare: cf-ipcountry). Anything unknown falls back to USD, never to a guess. */
export function detectCurrency(opts: { cookie?: string | null; country?: string | null }): CurrencyCode {
  if (isCurrency(opts.cookie)) return opts.cookie;
  const c = (opts.country ?? '').trim().toUpperCase();
  if (EURO.has(c)) return 'EUR';
  return BY_COUNTRY[c] ?? DEFAULT_CURRENCY;
}

export function formatMoney(amount: number, currency: CurrencyCode): string {
  const whole = Number.isInteger(amount) || currency === 'JPY';
  return new Intl.NumberFormat(LOCALE[currency], { style: 'currency', currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(amount);
}
/** Annual vs 12 monthly payments, as a whole percent. */
export function savePercent(currency: CurrencyCode): number {
  const p = PRICES[currency]; return Math.max(0, Math.round((1 - p.proAnnual / (p.proMonthly * 12)) * 100));
}
export const proPerMonthWhenAnnual = (currency: CurrencyCode) => PRICES[currency].proAnnual / 12;
