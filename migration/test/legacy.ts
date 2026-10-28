import assert from 'node:assert/strict';
import { legacyUserUuid } from '../lib/legacy/ids';
import { extractLegacyToken, knoxDigest, verifyViaDjango, VerifyUnavailable } from '../lib/legacy/verify';
import { exchangeLegacyToken, memoryLimiter, type ExchangeDeps } from '../lib/legacy/exchange';
import { checkUrl } from '../../importexport/lib/import/normalize';

let n = 0; const t = async (name: string, fn: () => Promise<void> | void) => { await fn(); n++; console.log('ok', name); };
const TOKEN = 'a'.repeat(64);

(async () => {
  await t('uuid5 equals Python for the same Django ids (cross-language vectors)', () => {
    assert.equal(legacyUserUuid(1), '9c356176-3b62-55c8-8447-bf95a3db0ff5');
    assert.equal(legacyUserUuid(42), 'c8bd5f47-c0e7-507d-95da-deb5deb8930d');
    assert.equal(legacyUserUuid(99999), 'cdf9b33f-efc7-582c-82b0-c2de4d8df984');
  });
  await t('knox digest equals Python hashlib.sha512', () => assert.ok(knoxDigest(TOKEN).startsWith('01d35c10c6c38c2dcf48f7ee')));
  await t('extractLegacyToken: Token/Bearer ok; JWTs, junk and oversize rejected', () => {
    assert.equal(extractLegacyToken(`Token ${TOKEN}`), TOKEN); assert.equal(extractLegacyToken(`bearer ${TOKEN}`), TOKEN);
    for (const bad of [null, '', 'Basic abc', 'Bearer a.b.c', `Bearer ${'a'.repeat(200)}`, 'Bearer short', `Token ${TOKEN} extra`, 'Bearer ../../etc/passwd'])
      assert.equal(extractLegacyToken(bad as any), null, String(bad));
  });
  await t('url keys match Python for the same inputs', () => {
    const keys = ['HTTPS://Www.X.com:443/p/?utm_source=a&b=2&a=1#f', 'http://a.com:8080/x', 'https://a.com', 'https://a.com/?fbclid=1'].map((u) => (checkUrl(u) as any).key);
    console.log('   ', JSON.stringify(keys));
    assert.deepEqual(keys, ['x.com/p?a=1&b=2', 'a.com:8080/x', 'a.com', 'a.com']);
  });

  const session = { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 };
  const deps = (o: Partial<ExchangeDeps & { email: string | null; exists: boolean; django: any }> = {}) => {
    const calls: string[] = [];
    const d: ExchangeDeps = {
      verify: async () => (o.django === undefined ? { id: 7, email: 'a@x.com' } : o.django),
      admin: {
        getUserById: async (id) => { calls.push('get:' + id); return o.exists === false ? { data: { user: null }, error: { message: 'nf' } } : { data: { user: { id, email: o.email === undefined ? 'a@x.com' : o.email } }, error: null }; },
        generateLink: async (a) => { calls.push('link:' + a.email); return { data: { properties: { hashed_token: 'HASH' } }, error: null }; },
      },
      verifyOtp: async (a) => { calls.push('otp:' + a.token_hash); return { data: { session }, error: null }; },
      audit: (e, f) => calls.push('audit:' + JSON.stringify({ e, f })), ...o,
    };
    return { d, calls };
  };

  await t('exchange: valid token → session; uses the deterministic id, looks user up before generating a link', async () => {
    const { d, calls } = deps(); const r = await exchangeLegacyToken(d, TOKEN, 'ip');
    assert.ok(r.ok && r.session.access_token === 'AT' && r.userId === legacyUserUuid(7));
    assert.deepEqual(calls.filter((c) => !c.startsWith('audit')), [`get:${legacyUserUuid(7)}`, 'link:a@x.com', 'otp:HASH']);
    assert.ok(!JSON.stringify(calls).includes(TOKEN), 'token must never appear in audit logs');
  });
  await t('exchange: invalid token → 401, nothing minted', async () => {
    const { d, calls } = deps({ django: null }); const r = await exchangeLegacyToken(d, TOKEN, 'ip');
    assert.deepEqual([r.ok, (r as any).status], [false, 401]); assert.ok(!calls.some((c) => c.startsWith('link') || c.startsWith('otp')));
  });
  await t('exchange: user not migrated → 409 and NO account is created (generateLink never called)', async () => {
    const { d, calls } = deps({ exists: false }); const r = await exchangeLegacyToken(d, TOKEN, 'ip');
    assert.equal((r as any).status, 409); assert.ok(!calls.some((c) => c.startsWith('link')));
  });
  await t('exchange: email changed since migration → refused', async () => {
    const { d, calls } = deps({ email: 'other@x.com' }); assert.equal(((await exchangeLegacyToken(d, TOKEN, 'ip')) as any).status, 409); assert.ok(!calls.some((c) => c.startsWith('link')));
  });
  await t('exchange: Django down → 503; sunset → 410; rate limit → 429', async () => {
    assert.equal(((await exchangeLegacyToken(deps({ verify: async () => { throw new VerifyUnavailable('x'); } }).d, TOKEN, 'ip')) as any).status, 503);
    assert.equal(((await exchangeLegacyToken(deps({ sunset: '2026-01-01', now: () => Date.parse('2026-06-01') }).d, TOKEN, 'ip')) as any).status, 410);
    const lim = memoryLimiter(2, 60_000); const { d } = deps({ limiter: lim });
    const out = []; for (let i = 0; i < 4; i++) out.push(((await exchangeLegacyToken(d, TOKEN, 'same-ip')) as any).status ?? 200);
    assert.deepEqual(out, [200, 200, 429, 429]);
    assert.equal(((await exchangeLegacyToken(d, TOKEN, 'other-ip')) as any).status ?? 200, 200);
  });
  await t('verifyViaDjango: 200 → user, 401 → null, 500/network → unavailable, sends Token header', async () => {
    let seen: any; const f = (status: number, body?: any) => (async (url: any, init: any) => { seen = { url, h: init.headers }; return new Response(JSON.stringify(body ?? {}), { status }); }) as any;
    assert.deepEqual(await verifyViaDjango(TOKEN, 'https://api.x.com/', f(200, { id: 7, email: 'A@X.com' })), { id: 7, email: 'a@x.com' });
    assert.equal(seen.url, 'https://api.x.com/api/auth/user/'); assert.equal(seen.h.Authorization, `Token ${TOKEN}`);
    assert.equal(await verifyViaDjango(TOKEN, 'https://api.x.com', f(401)), null);
    assert.equal(await verifyViaDjango(TOKEN, 'https://api.x.com', f(200, { id: 'x' })), null);
    await assert.rejects(verifyViaDjango(TOKEN, 'https://api.x.com', f(500)), VerifyUnavailable);
    await assert.rejects(verifyViaDjango(TOKEN, 'https://api.x.com', (async () => { throw new Error('net'); }) as any), VerifyUnavailable);
  });
  console.log(`\n${n} tests passed`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
