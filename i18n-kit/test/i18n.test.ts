import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLocale, localeFromAcceptLanguage, localeFromCountry, splitLocale, withLocale, isLocale } from '../i18n';

test('cookie beats everything', () => assert.equal(resolveLocale({ cookie: 'ja', acceptLanguage: 'de', country: 'ES' }), 'ja'));
test('invalid cookie is ignored', () => assert.equal(resolveLocale({ cookie: 'xx', acceptLanguage: 'de-DE', country: 'JP' }), 'de'));
test('cookie with injection characters is ignored', () => assert.equal(resolveLocale({ cookie: 'en; Path=/', country: 'DE' }), 'de'));
test('accept-language q-values and regions', () => {
  assert.equal(localeFromAcceptLanguage('fr-FR,fr;q=0.9,hi-IN;q=0.8,en;q=0.7'), 'hi');
  assert.equal(localeFromAcceptLanguage('en;q=0.5, es-MX;q=0.9'), 'es');
  assert.equal(localeFromAcceptLanguage('ES-es'), 'es');
  assert.equal(localeFromAcceptLanguage('fr, it;q=0.8'), null);
  assert.equal(localeFromAcceptLanguage('*'), null);
  assert.equal(localeFromAcceptLanguage('de;q=0'), null);
  assert.equal(localeFromAcceptLanguage(''), null);
  assert.equal(localeFromAcceptLanguage('de;q=abc'), null);
});
test('country mapping', () => {
  assert.equal(localeFromCountry('DE'), 'de'); assert.equal(localeFromCountry('jp'), 'ja'); assert.equal(localeFromCountry('MX'), 'es');
  assert.equal(localeFromCountry('IN'), 'en'); assert.equal(localeFromCountry('BR'), null); assert.equal(localeFromCountry(undefined), null);
});
test('no signals -> en; country used when browser language is unsupported', () => {
  assert.equal(resolveLocale({}), 'en'); assert.equal(resolveLocale({ acceptLanguage: 'fr', country: 'DE' }), 'de');
});
test('splitLocale / withLocale', () => {
  assert.deepEqual(splitLocale('/de/dashboard/x'), { locale: 'de', rest: '/dashboard/x' });
  assert.deepEqual(splitLocale('/de'), { locale: 'de', rest: '/' });
  assert.deepEqual(splitLocale('/dashboard'), { locale: null, rest: '/dashboard' });
  assert.deepEqual(splitLocale('/deutsch'), { locale: null, rest: '/deutsch' });
  assert.equal(withLocale('/', 'ja'), '/ja'); assert.equal(withLocale('/dashboard', 'ja'), '/ja/dashboard'); assert.equal(withLocale('/en/dashboard', 'hi'), '/hi/dashboard');
  assert.equal(withLocale('//evil.com', 'en'), '/en//evil.com');
  assert.ok(isLocale('hi') && !isLocale('HI') && !isLocale(undefined));
});
