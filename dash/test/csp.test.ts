import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCsp, makeNonce, STATIC_SECURITY_HEADERS } from '../lib/security/csp';

const n = 'dGVzdG5vbmNlMTIzNDU2Nzg=';
const dir = (csp: string, name: string) => csp.split('; ').find((p) => p.startsWith(name + ' '))?.split(' ').slice(1) ?? [];

test('production CSP: nonce + strict-dynamic, no unsafe-eval, no inline scripts, no objects, no framing, https upgrade', () => {
  const c = buildCsp({ nonce: n, supabaseUrl: 'https://abcd.supabase.co' });
  assert.ok(dir(c, 'script-src').includes(`'nonce-${n}'`) && dir(c, 'script-src').includes("'strict-dynamic'"));
  assert.ok(!dir(c, 'script-src').includes("'unsafe-eval'") && !dir(c, 'script-src').includes("'unsafe-inline'"));
  assert.deepEqual(dir(c, 'object-src'), ["'none'"]); assert.deepEqual(dir(c, 'frame-ancestors'), ["'none'"]); assert.deepEqual(dir(c, 'base-uri'), ["'none'"]);
  assert.ok(c.includes('upgrade-insecure-requests'));
  assert.ok(dir(c, 'connect-src').includes('https://abcd.supabase.co') && dir(c, 'connect-src').includes('wss://abcd.supabase.co'));
  assert.ok(!c.includes('*.supabase.co'), 'with a configured project URL the wildcard is not used');
});
test('dev CSP allows eval + localhost websockets (HMR) and does not force https', () => {
  const c = buildCsp({ nonce: n, isDev: true });
  assert.ok(dir(c, 'script-src').includes("'unsafe-eval'")); assert.ok(dir(c, 'connect-src').some((x) => x.startsWith('ws://localhost'))); assert.ok(!c.includes('upgrade-insecure-requests'));
});
test('a weak or injected nonce is refused (no ; or spaces can smuggle a directive)', () => {
  for (const bad of ['', 'short', "abc'; script-src *; x='", 'has space in it 123456']) assert.throws(() => buildCsp({ nonce: bad }));
});
test('every directive that Stripe Checkout and the YouTube embed need is present, and nothing is wildcard except images', () => {
  const c = buildCsp({ nonce: n });
  assert.ok(dir(c, 'frame-src').includes('https://js.stripe.com') && dir(c, 'frame-src').includes('https://www.youtube-nocookie.com'));
  assert.ok(dir(c, 'form-action').includes('https://checkout.stripe.com'));
  for (const d of ['script-src', 'connect-src', 'frame-src', 'default-src']) assert.ok(!dir(c, d).some((x) => x === '*' || x === 'https:' || x === 'http:'), d);
});
test('nonces are unique per call and long enough', () => { const a = makeNonce(), b = makeNonce(); assert.notEqual(a, b); assert.ok(a.length >= 22); assert.doesNotThrow(() => buildCsp({ nonce: a })); });
test('static headers: HSTS >= 1 year with includeSubDomains, nosniff, DENY framing, locked-down Permissions-Policy', () => {
  const h = Object.fromEntries(STATIC_SECURITY_HEADERS.map((x) => [x.key, x.value]));
  const age = Number(/max-age=(\d+)/.exec(h['Strict-Transport-Security'])![1]); assert.ok(age >= 31536000); assert.match(h['Strict-Transport-Security'], /includeSubDomains/);
  assert.equal(h['X-Content-Type-Options'], 'nosniff'); assert.equal(h['X-Frame-Options'], 'DENY'); assert.match(h['Permissions-Policy'], /camera=\(\)/);
});
