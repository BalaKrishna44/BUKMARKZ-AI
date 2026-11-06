import test from 'node:test'; import assert from 'node:assert/strict';
import { PRICES, CURRENCIES, detectCurrency, formatMoney, savePercent, isCurrency } from './currency';
const strip = (s: string) => s.replace(/ /g, ' ');
test('Pro is $2 a month in USD', () => { assert.equal(PRICES.USD.proMonthly, 2); assert.equal(strip(formatMoney(2, 'USD')), '$2'); });
test('country -> currency: US dollar, euro countries, India rupee, UK pound, fallback', () => {
  assert.equal(detectCurrency({ country: 'US' }), 'USD'); assert.equal(detectCurrency({ country: 'DE' }), 'EUR'); assert.equal(detectCurrency({ country: 'fr' }), 'EUR');
  assert.equal(detectCurrency({ country: 'IN' }), 'INR'); assert.equal(detectCurrency({ country: 'GB' }), 'GBP');
  assert.equal(detectCurrency({ country: 'ZZ' }), 'USD'); assert.equal(detectCurrency({}), 'USD'); assert.equal(detectCurrency({ country: null }), 'USD');
});
test('non-euro EU members are not euro (e.g. Poland, Sweden)', () => { assert.equal(detectCurrency({ country: 'PL' }), 'USD'); assert.equal(detectCurrency({ country: 'SE' }), 'USD'); });
test('a valid cookie overrides the country; an invalid one is ignored', () => {
  assert.equal(detectCurrency({ cookie: 'EUR', country: 'IN' }), 'EUR'); assert.equal(detectCurrency({ cookie: 'XXX', country: 'IN' }), 'INR'); assert.equal(detectCurrency({ cookie: '__proto__' }), 'USD');
});
test('formatting', () => {
  assert.equal(strip(formatMoney(149, 'INR')), '₹149'); assert.equal(strip(formatMoney(1299, 'INR')), '₹1,299');
  assert.equal(strip(formatMoney(2, 'EUR')), '€2'); assert.equal(strip(formatMoney(1.99, 'GBP')), '£1.99');
  assert.equal(strip(formatMoney(300, 'JPY')), '¥300'); assert.equal(strip(formatMoney(12.99, 'USD')), '$12.99');
  assert.match(strip(formatMoney(9.9, 'BRL')), /9,90/);
});
test('every currency has sane, ordered price points and a positive annual saving', () => {
  for (const c of CURRENCIES) {
    const p = PRICES[c]; assert.ok(p.proMonthly > 0 && p.proAnnual > p.proMonthly && p.proAnnual < p.proMonthly * 12, `${c} annual must be cheaper than 12 months`);
    assert.ok(savePercent(c) >= 10 && savePercent(c) <= 40, `${c} saving ${savePercent(c)}%`); assert.ok(p.teamMonthly > p.proMonthly);
    assert.ok(isCurrency(c));
  }
});
test('savePercent USD', () => { assert.equal(savePercent('USD'), 21); });
test('CAD and AUD are unambiguous (CA$ / A$)', () => { assert.equal(strip(formatMoney(2.99, 'CAD')), 'CA$2.99'); assert.equal(strip(formatMoney(2.99, 'AUD')), 'A$2.99'); });
