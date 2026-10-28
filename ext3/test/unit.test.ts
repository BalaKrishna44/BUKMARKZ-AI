import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBridge } from '../src/content/bridge';
import { BRIDGE_CHANNEL } from '../src/shared/config';
import { reminderPresets } from '../src/shared/reminders';
import { jwtExp, looksLikeJwt } from '../src/shared/jwt';
import { buildSaveFromMenu, MENU, selectionNote } from '../src/shared/menu';
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
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const makeJwt = (exp: number) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', exp })}.c2lnbmF0dXJl`;
const TOKEN = makeJwt(4_000_000_000);
const okLogin = (): WorkerReply => ({ ok: true, session: { user: { id: 'u-7', email: 'k@example.com' }, expiresAt: 4_000_000_000 } });

test('bridge announces READY when it loads', () => {
  const { posted } = setup(okLogin);
  assert.equal(posted[0].data.type, 'READY');
  assert.equal(posted[0].origin, 'https://www.bukmarkz.com'); // never "*"
});

test('login is relayed once and the reply never contains the token', async () => {
  const { fire, sent, posted } = setup(okLogin);
  await fire(msg('AUTH_LOGIN', { accessToken: TOKEN }));
  assert.deepEqual(sent, [{ type: 'bridge:login', accessToken: TOKEN }]);
  const ack = posted.at(-1).data;
  assert.equal(ack.ok, true);
  assert.deepEqual(ack.user, { id: 'u-7', email: 'k@example.com' });
  assert.ok(!JSON.stringify(posted).includes(TOKEN));
});

test('messages from another window or origin are ignored', async () => {
  const { fire, sent, posted } = setup(okLogin);
  const before = posted.length;
  await fire(msg('AUTH_LOGIN', { accessToken: TOKEN }), { source: {} });            // an iframe
  await fire(msg('AUTH_LOGIN', { accessToken: TOKEN }), { origin: 'https://evil.example' });
  assert.equal(sent.length, 0);
  assert.equal(posted.length, before);
});

test('malformed, unknown and oversized messages are dropped', async () => {
  const { fire, sent } = setup(okLogin);
  await fire(null);
  await fire('hello');
  await fire({ ...msg('AUTH_LOGIN', { accessToken: TOKEN }), channel: 'other' });
  await fire({ ...msg('AUTH_LOGIN', { accessToken: TOKEN }), from: 'extension' });
  await fire(msg('DELETE_EVERYTHING'));
  await fire(msg('AUTH_LOGIN', { accessToken: TOKEN }, ''));
  await fire(msg('AUTH_LOGIN', { accessToken: TOKEN, junk: 'x'.repeat(9000) }));
  assert.equal(sent.length, 0);
});

test('bad tokens are rejected before reaching the worker', async () => {
  const { fire, sent, posted } = setup(okLogin);
  for (const accessToken of [undefined, 123, '', 'short', 'x'.repeat(300), 'a.b.c', 'Token abc.def.ghi', `${TOKEN}${'x'.repeat(5000)}`, { toString: 1 }]) await fire(msg('AUTH_LOGIN', { accessToken }));
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
  await fire(msg('AUTH_LOGIN', { accessToken: TOKEN }));
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

/* ---------- jwt helpers ---------- */
test('jwtExp reads the exp claim and survives garbage', () => {
  assert.equal(jwtExp(makeJwt(1_900_000_000)), 1_900_000_000);
  for (const bad of ['', 'a.b', 'a.b.c', 'x.!!!.z', `x.${b64({ exp: 'soon' })}.z`]) assert.equal(jwtExp(bad), null, bad);
  assert.equal(looksLikeJwt(TOKEN), true);
  for (const bad of [null, 5, 'abc', 'a.b.c', 'Bearer x.y.z', `${TOKEN}.extra`]) assert.equal(looksLikeJwt(bad), false, String(bad));
});

/* ---------- context menu ---------- */
const tab = { url: 'https://site.test/article', title: 'How [vector] search works', incognito: false };
test('three menu items with the contexts they need', () => {
  assert.deepEqual(Object.values(MENU).map((m) => [m.title, m.contexts.join('+')]), [
    ['Save Page to Bukmarkz', 'page+link'], ['Save Selection as Rich Note', 'selection'], ['Save Image to Bukmarkz', 'image']]);
  assert.equal(new Set(Object.values(MENU).map((m) => m.id)).size, 3);
});
test('menu: page, link, selection and image become the right save request', () => {
  const page = buildSaveFromMenu({ menuItemId: MENU.page.id, pageUrl: tab.url }, tab);
  assert.deepEqual(page.ok && [page.input.kind, page.input.url, page.input.title], ['page', tab.url, tab.title]);
  const link = buildSaveFromMenu({ menuItemId: MENU.page.id, pageUrl: tab.url, linkUrl: 'https://other.test/x' }, tab);
  assert.deepEqual(link.ok && [link.input.url, link.input.title], ['https://other.test/x', '']);   // saving a link, not the page it sits on
  const sel = buildSaveFromMenu({ menuItemId: MENU.selection.id, pageUrl: tab.url, selectionText: '  line one\nline two  ' }, tab);
  assert.ok(sel.ok && sel.input.kind === 'selection' && sel.input.url === tab.url);
  assert.equal(sel.ok && sel.input.note, '> line one\n> line two\n\n— [How \\[vector\\] search works](https://site.test/article)');
  const img = buildSaveFromMenu({ menuItemId: MENU.image.id, pageUrl: tab.url, srcUrl: 'https://cdn.test/a (1).png' }, tab);
  assert.ok(img.ok && img.input.kind === 'image' && img.input.imageUrl === 'https://cdn.test/a (1).png');
  assert.equal(img.ok && img.input.note, '![image](https://cdn.test/a%20%281%29.png)');
});
test('menu: refuses what cannot be saved, with a reason', () => {
  for (const [info, t] of [
    [{ menuItemId: MENU.page.id, pageUrl: 'chrome://settings' }, { url: 'chrome://settings' }],
    [{ menuItemId: MENU.selection.id, pageUrl: tab.url, selectionText: '   ' }, tab],
    [{ menuItemId: MENU.image.id, pageUrl: tab.url, srcUrl: 'data:image/png;base64,AAAA' }, tab],
    [{ menuItemId: MENU.image.id, pageUrl: tab.url, srcUrl: 'blob:https://site.test/1' }, tab],
    [{ menuItemId: MENU.selection.id, pageUrl: 'file:///x', selectionText: 'x' }, { url: 'file:///x' }],
    [{ menuItemId: 'something-else', pageUrl: tab.url }, tab],
  ] as const) { const r = buildSaveFromMenu(info as any, t as any); assert.equal(r.ok, false, JSON.stringify(info)); assert.ok(!r.ok && r.reason.length > 5); }
});
test('menu: incognito is decided by the browser tab, so the save is private', () => {
  const r = buildSaveFromMenu({ menuItemId: MENU.page.id, pageUrl: tab.url }, { ...tab, incognito: true });
  assert.ok(r.ok && r.input.private === true);
  assert.ok(selectionNote('x'.repeat(50_000), 't', tab.url).length <= 10_000);
});
test('sanitizeSave: kinds, image URL rules and rich-note length', () => {
  const sel = sanitizeSave({ url: 'https://a.com', kind: 'selection', note: 'n'.repeat(9000) })!;
  assert.equal([sel.kind, sel.note.length].join(), 'selection,9000');
  assert.equal(sanitizeSave({ url: 'https://a.com', note: 'n'.repeat(9000) })!.note.length, 2000);        // plain page notes stay short
  assert.equal(sanitizeSave({ url: 'https://a.com', kind: 'bogus' })!.kind, 'page');
  assert.equal(sanitizeSave({ url: 'https://a.com', kind: 'image' }), null);
  assert.equal(sanitizeSave({ url: 'https://a.com', kind: 'image', imageUrl: 'javascript:alert(1)' }), null);
  assert.equal(sanitizeSave({ url: 'https://a.com', kind: 'image', imageUrl: 'https://c.test/a.png' })!.imageUrl, 'https://c.test/a.png');
});

test('bridge: a refresh request from our own worker becomes a REFRESH_REQUEST for the page; others are ignored', async () => {
  const { createBridge } = await import('../src/content/bridge');
  const posted: any[] = [];
  const win: any = { location: { origin: 'https://www.bukmarkz.com' }, addEventListener() {}, postMessage: (d: any, o: string) => posted.push({ d, o }) };
  const b = createBridge({ win, sendToWorker: async () => ({ ok: true }) });
  posted.length = 0;
  assert.equal(b.onWorkerMessage({ type: 'bridge:refresh-request' }, 'ext-id', 'ext-id'), true);
  assert.equal(posted.length, 1); assert.equal(posted[0].d.type, 'REFRESH_REQUEST'); assert.equal(posted[0].o, 'https://www.bukmarkz.com');
  assert.ok(!JSON.stringify(posted).match(/token/i), 'no token in the message');
  assert.equal(b.onWorkerMessage({ type: 'bridge:refresh-request' }, 'other-ext', 'ext-id'), false);   // another extension
  assert.equal(b.onWorkerMessage({ type: 'bridge:login' }, 'ext-id', 'ext-id'), false);               // wrong type
  assert.equal(b.onWorkerMessage(null, 'ext-id', 'ext-id'), false);
  assert.equal(posted.length, 1);
});
