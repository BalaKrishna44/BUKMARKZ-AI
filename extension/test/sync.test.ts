import assert from 'node:assert/strict';
import { test } from 'node:test';

/** A tiny browser: window with listeners, and a fake extension bridge that answers like bridge.ts does. */
function setup(opts: { extension: 'ok' | 'absent' | 'refuse' } = { extension: 'ok' }) {
  const listeners: ((e: any) => void)[] = []; const log: any[] = [];
  const win: any = {
    location: { origin: 'https://www.bukmarkz.com' },
    addEventListener: (_: string, f: any) => listeners.push(f), removeEventListener: (_: string, f: any) => { listeners.splice(listeners.indexOf(f), 1); },
    postMessage: (data: any, origin: string) => {
      log.push({ data, origin });
      if (data.from !== 'page' || opts.extension === 'absent') return;
      setTimeout(() => [...listeners].forEach((l) => l({ source: win, origin: win.location.origin, data: { channel: 'bukmarkz.bridge.v1', from: 'extension', type: 'ACK', requestId: data.requestId, ok: opts.extension === 'ok' } })), 0);
    },
  };
  (globalThis as any).window = win;
  const emit = (data: any, over: any = {}) => [...listeners].forEach((l) => l({ source: win, origin: win.location.origin, data, ...over }));
  let cb: (e: string, s: any) => void = () => {}; let current: any = null; let unsub = 0;
  const supabase: any = { auth: {
    onAuthStateChange: (f: any) => { cb = f; return { data: { subscription: { unsubscribe: () => unsub++ } } }; },
    getSession: async () => ({ data: { session: current } }),
  } };
  return { win, log, emit, supabase, fire: (e: string, s: any) => { current = s; cb(e, s); }, unsub: () => unsub, sent: () => log.filter((l) => l.data.from === 'page').map((l) => l.data) };
}
const sess = (t: string) => ({ access_token: t, refresh_token: 'REFRESH-SECRET', user: { id: 'u' } });
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
(globalThis as any).crypto ??= require('node:crypto').webcrypto;

test('sign-in posts only the ACCESS token to our own origin; refresh token never leaves; sign-out is relayed', async () => {
  const { startExtensionSync } = await import('../web/syncLoginToExtension');
  const t = setup(); const stop = startExtensionSync(t.supabase);
  t.fire('SIGNED_IN', sess('AT1')); await tick();
  assert.deepEqual(t.sent().map((m) => [m.type, m.payload?.accessToken]), [['AUTH_LOGIN', 'AT1']]);
  assert.ok(t.log.every((l) => l.origin === 'https://www.bukmarkz.com'));
  assert.ok(!JSON.stringify(t.log).includes('REFRESH-SECRET'));
  t.fire('TOKEN_REFRESHED', sess('AT2')); await tick();
  t.fire('TOKEN_REFRESHED', sess('AT2')); await tick();                         // duplicate event: not re-sent
  t.fire('SIGNED_OUT', null); await tick();
  t.fire('SIGNED_OUT', null); await tick();                                      // duplicate: not re-sent
  assert.deepEqual(t.sent().map((m) => [m.type, m.payload?.accessToken]), [['AUTH_LOGIN', 'AT1'], ['AUTH_LOGIN', 'AT2'], ['AUTH_LOGOUT', undefined]]);
  stop(); assert.equal(t.unsub(), 1);
});
test('a password-recovery session is never shared', async () => {
  const { startExtensionSync } = await import('../web/syncLoginToExtension');
  const t = setup(); startExtensionSync(t.supabase); t.fire('PASSWORD_RECOVERY', sess('RECOVERY')); await tick();
  assert.equal(t.sent().length, 0);
});
test('no extension installed: quiet, no retry storm', async () => {
  const { startExtensionSync } = await import('../web/syncLoginToExtension');
  const t = setup({ extension: 'absent' }); startExtensionSync(t.supabase); t.fire('SIGNED_IN', sess('AT')); await tick(2300);
  assert.equal(t.sent().length, 1);
});
test('extension refuses (e.g. another account connected): not retried in a loop', async () => {
  const { startExtensionSync } = await import('../web/syncLoginToExtension');
  const t = setup({ extension: 'refuse' }); startExtensionSync(t.supabase); t.fire('SIGNED_IN', sess('AT')); await tick();
  assert.equal(t.sent().length, 1);
});
test('extension that loads late announces READY and receives the current session', async () => {
  const { startExtensionSync } = await import('../web/syncLoginToExtension');
  const t = setup(); startExtensionSync(t.supabase); t.fire('SIGNED_IN', sess('AT')); await tick();
  t.emit({ channel: 'bukmarkz.bridge.v1', from: 'extension', type: 'READY', requestId: 'announce' }); await tick(40);
  assert.equal(t.sent().filter((m) => m.type === 'AUTH_LOGIN').length, 2);
  t.emit({ channel: 'bukmarkz.bridge.v1', from: 'extension', type: 'READY', requestId: 'x' }, { origin: 'https://evil.test' }); await tick(40);   // wrong origin ignored
  assert.equal(t.sent().filter((m) => m.type === 'AUTH_LOGIN').length, 2);
});
