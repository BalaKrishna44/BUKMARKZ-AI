import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBridge } from '../src/content/bridge';
import { BRIDGE_CHANNEL } from '../src/shared/config';
import { reminderPresets } from '../src/shared/reminders';
import { cleanTag, cleanTags, isSavableUrl, normalizeUrl, sanitizeSave } from '../src/shared/validate';
import type { ToWorker, WorkerReply } from '../src/shared/messages';

/* ---------- a tiny fake window ---------- */
function setup(reply: (m: ToWorker) => Promise<WorkerReply> | WorkerReply, now = () => 1_000_000) {
  const posted: any[] = [];
  const listeners: Array<(e: any) => void> = [];
  const sent: ToWorker[] = [];
  const win: any = {
    location: { origin: 'https://www.bukmarkz.com' },
    addEventListener: (_: string, cb: (e: any) => void) => listeners.push(cb),
    postMessage: (data: unknown, origin: string) => posted.push({ data, origin }),
  };
  const bridge = createBridge({ win, now, sendToWorker: async (m) => { sent.push(m); return reply(m); } });
  const fire = async (data: unknown, over: Partial<{ source: unknown; origin: string }> = {}) => {
    await bridge.onMessage({ source: 'source' in over ? over.source : win, origin: over.origin ?? 'https://www.bukmarkz.com', data } as any);
  };
  return { win, posted, sent, fire };
}
const msg = (type: string, payload?: object, requestId = 'r1') => ({ channel: BRIDGE_CHANNEL, from: 'page', type, requestId, payload });
const TOKEN = 'a'.repeat(64);
const okLogin = (): WorkerReply => ({ ok: true, session: { user: { id: 7, email: 'k@example.com' }, expiry: null } });

test('bridge announces READY when it loads', () => {
  const { posted } = setup(okLogin);
  assert.equal(posted[0].data.type, 'READY');
  assert.equal(posted[0].origin, 'https://www.bukmarkz.com'); // never "*"
});

test('login is relayed once and the reply never contains the token', async () => {
  const { fire, sent, posted } = setup(okLogin);
  await fire(msg('AUTH_LOGIN', { token: TOKEN, expiry: '2030-01-01T00:00:00Z' }));
  assert.deepEqual(sent, [{ type: 'bridge:login', token: TOKEN, expiry: '2030-01-01T00:00:00Z' }]);
  const ack = posted.at(-1).data;
  assert.equal(ack.ok, true);
  assert.deepEqual(ack.user, { id: 7, email: 'k@example.com' });
  assert.ok(!JSON.stringify(posted).includes(TOKEN));
});

test('messages from another window or origin are ignored', async () => {
  const { fire, sent, posted } = setup(okLogin);
  const before = posted.length;
  await fire(msg('AUTH_LOGIN', { token: TOKEN }), { source: {} });            // an iframe
  await fire(msg('AUTH_LOGIN', { token: TOKEN }), { origin: 'https://evil.example' });
  assert.equal(sent.length, 0);
  assert.equal(posted.length, before);
});

test('malformed, unknown and oversized messages are dropped', async () => {
  const { fire, sent } = setup(okLogin);
  await fire(null);
  await fire('hello');
  await fire({ ...msg('AUTH_LOGIN', { token: TOKEN }), channel: 'other' });
  await fire({ ...msg('AUTH_LOGIN', { token: TOKEN }), from: 'extension' });
  await fire(msg('DELETE_EVERYTHING'));
  await fire(msg('AUTH_LOGIN', { token: TOKEN }, ''));
  await fire(msg('AUTH_LOGIN', { token: TOKEN, junk: 'x'.repeat(9000) }));
  assert.equal(sent.length, 0);
});

test('bad tokens are rejected before reaching the worker', async () => {
  const { fire, sent, posted } = setup(okLogin);
  for (const token of [undefined, 123, '', 'short', 'x'.repeat(300), { toString: 1 }]) await fire(msg('AUTH_LOGIN', { token }));
  assert.equal(sent.length, 0);
  assert.ok(posted.slice(1).every((p) => p.data.ok === false && p.data.code === 'bad_input'));
});

test('rate limit: 10 messages per 10 seconds, then it recovers', async () => {
  let t = 0;
  const { fire, sent, posted } = setup(okLogin, () => t);
  for (let i = 0; i < 12; i++) await fire(msg('STATUS', undefined, `r${i}`));
  assert.equal(sent.length, 10);
  assert.equal(posted.at(-1).data.code, 'rate_limited');
  t = 11_000;
  await fire(msg('STATUS', undefined, 'later'));
  assert.equal(sent.length, 11);
});

test('a dead extension context gives a clear failure instead of throwing', async () => {
  const { fire, posted } = setup(() => { throw new Error('Extension context invalidated.'); });
  await fire(msg('AUTH_LOGOUT'));
  assert.equal(posted.at(-1).data.code, 'extension_unavailable');
});

test('worker errors are passed on as codes', async () => {
  const { fire, posted } = setup(() => ({ ok: false, error: 'nope', code: 'invalid_token' }));
  await fire(msg('AUTH_LOGIN', { token: TOKEN }));
  assert.equal(posted.at(-1).data.ok, false);
  assert.equal(posted.at(-1).data.code, 'invalid_token');
});

/* ---------- validation ---------- */
test('only http(s) pages are savable', () => {
  assert.equal(isSavableUrl('https://a.com/x'), true);
  for (const bad of ['chrome://settings', 'file:///etc/passwd', 'javascript:alert(1)', 'about:blank', '', undefined, 'not a url', 'data:text/html,hi']) assert.equal(isSavableUrl(bad as any), false, String(bad));
});

test('URLs are normalised: no fragment, no tracking params, real params kept', () => {
  assert.equal(normalizeUrl('https://a.com/p?id=3&utm_source=x&fbclid=y#top'), 'https://a.com/p?id=3');
});

test('tags are cleaned, de-duplicated and capped', () => {
  assert.equal(cleanTag('  #Machine Learning!! '), 'machine-learning');
  assert.deepEqual(cleanTags(['AI', 'ai', '#ai', '', '  ']), ['ai']);
  assert.equal(cleanTags(Array.from({ length: 30 }, (_, i) => `t${i}`)).length, 8);
  assert.equal(cleanTag('x'.repeat(100)).length, 24);
});

test('sanitizeSave rejects bad input and bounds good input', () => {
  assert.equal(sanitizeSave(null), null);
  assert.equal(sanitizeSave({ url: 'chrome://x' }), null);
  const now = Date.now();
  const ok = sanitizeSave({ url: 'https://a.com/#x', title: 'T'.repeat(300), note: 'n'.repeat(5000), tags: ['A'], remindAt: now + 60_000, private: true })!;
  assert.equal(ok.url, 'https://a.com/');
  assert.equal(ok.title.length, 100);
  assert.equal(ok.note.length, 2000);
  assert.equal(ok.private, true);
  assert.equal(ok.remindAt, now + 60_000);
  assert.equal(sanitizeSave({ url: 'https://a.com', remindAt: now - 1 })!.remindAt, null);                 // past
  assert.equal(sanitizeSave({ url: 'https://a.com', remindAt: now + 400 * 86_400_000 })!.remindAt, null);  // > 1 year
  assert.equal(sanitizeSave({ url: 'https://a.com', remindAt: NaN })!.remindAt, null);
  assert.equal(sanitizeSave({ url: 'https://a.com', private: 'yes' })!.private, false);                    // only literal true counts
});

test('reminder presets are in the future and ordered sensibly', () => {
  const now = new Date(2026, 9, 20, 15, 0, 0); // Tue 20 Oct 2026 15:00 local
  const p = Object.fromEntries(reminderPresets(now).map((x) => [x.id, x.at]));
  assert.equal(p.none, null);
  assert.equal(p['1h'], now.getTime() + 3_600_000);
  assert.equal(new Date(p.tonight!).getHours(), 20);
  assert.equal(new Date(p.tonight!).getDate(), 20);
  assert.equal(new Date(p.tomorrow!).getDate(), 21);
  assert.equal(new Date(p['3d']!).getDate(), 23);
  assert.equal(new Date(p.week!).getDay(), 1);        // Monday
  assert.equal(new Date(p.week!).getDate(), 26);
  for (const k of ['1h', 'tonight', 'tomorrow', '3d', 'week']) assert.ok(p[k]! > now.getTime(), k);
  const late = reminderPresets(new Date(2026, 9, 20, 22, 0, 0)).find((x) => x.id === 'tonight')!;
  assert.equal(new Date(late.at!).getDate(), 21);     // after 8 pm rolls to tomorrow
  const monday = reminderPresets(new Date(2026, 9, 19, 10, 0, 0)).find((x) => x.id === 'week')!;
  assert.equal(new Date(monday.at!).getDate(), 26);   // on a Monday, "next Monday" is a week away
});
