import test from 'node:test';
import assert from 'node:assert/strict';
import { middleware } from '../middleware';
import { calls } from './stub_updatesession';

function req(path: string, headers: Record<string, string> = {}, cookies: Record<string, string> = {}) {
  const url = new URL('https://bukmarkz.com' + path);
  return { nextUrl: Object.assign(url, { clone: () => new URL(url.toString()) }), headers: new Headers(headers), cookies: { get: (n: string) => (n in cookies ? { value: cookies[n] } : undefined) } } as any;
}
const loc = (r: Response) => new URL(r.headers.get('location')!).pathname + new URL(r.headers.get('location')!).search;

test('Germany, no cookie -> /de keeps path and query', async () => {
  const r = await middleware(req('/dashboard?tab=tasks&q=a%20b', { 'x-vercel-ip-country': 'DE' }));
  assert.equal(r.status, 307); assert.equal(loc(r), '/de/dashboard?tab=tasks&q=a%20b');
  assert.match(r.headers.get('vary')!, /Accept-Language/); assert.match(r.headers.get('cache-control')!, /no-store/);
});
test('Cloudflare header works', async () => assert.equal(loc(await middleware(req('/', { 'cf-ipcountry': 'JP' }))), '/ja'));
test('India + Hindi browser -> hi; India + English -> en', async () => {
  assert.equal(loc(await middleware(req('/', { 'x-vercel-ip-country': 'IN', 'accept-language': 'hi-IN,hi;q=0.9' }))), '/hi');
  assert.equal(loc(await middleware(req('/', { 'x-vercel-ip-country': 'IN', 'accept-language': 'en-IN' }))), '/en');
});
test('cookie overrides country and browser language', async () => {
  assert.equal(loc(await middleware(req('/pricing', { 'x-vercel-ip-country': 'DE', 'accept-language': 'de' }, { NEXT_LOCALE: 'es' }))), '/es/pricing');
});
test('nothing known -> en', async () => assert.equal(loc(await middleware(req('/'))), '/en'));
test('locale already in URL is served, not redirected, and auth gets the locale-free path', async () => {
  calls.length = 0;
  const r = await middleware(req('/de/dashboard', {}, { NEXT_LOCALE: 'ja' }));
  assert.equal(r.status, 200); assert.equal(r.headers.get('x-session'), '1');
  assert.deepEqual(calls[0], { path: '/dashboard', loginPath: '/de/login' });
});
test('unknown prefix is treated as a path and gets a locale', async () => {
  assert.equal(loc(await middleware(req('/xx/dashboard', { 'accept-language': 'es' }))), '/es/xx/dashboard');
});
test('open-redirect attempt stays on this origin', async () => {
  const r = await middleware(req('//evil.com/x', { 'x-vercel-ip-country': 'DE' }));
  assert.equal(new URL(r.headers.get('location')!).origin, 'https://bukmarkz.com');
});
