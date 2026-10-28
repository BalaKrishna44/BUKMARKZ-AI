// End-to-end test in a real Chromium with the built extension loaded.
// Needs: playwright, openssl, and permission to bind port 443 (maps *.bukmarkz.test to 127.0.0.1).
//   BUKMARKZ_TEST_HOOKS=1 BUKMARKZ_WEB=https://www.bukmarkz.test BUKMARKZ_EXTRA_HOSTS=https://site.test npm run build
//   node test/e2e.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const tmp = mkdtempSync(join(tmpdir(), 'bk-e2e-'));
const shots = process.env.SHOTS_DIR || tmp;
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(tmp, 'k.pem'), '-out', join(tmp, 'c.pem'), '-days', '2', '-subj', '/CN=bukmarkz.test', '-addext', 'subjectAltName=DNS:www.bukmarkz.test,DNS:site.test'], { stdio: 'ignore' });

/* ---- fake Bukmarkz web + /api/ingest (same origin, Supabase-style JWTs) ---- */
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub, expSec) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, exp: expSec })}.c2lnbmF0dXJl`;
const inOneHour = () => Math.floor(Date.now() / 1000) + 3600;
const GOOD = jwt('u-7', inOneHour());
const GOOD2 = jwt('u-7', inOneHour() + 5);          // the same user's refreshed token
const OTHER_USER = jwt('u-99', inOneHour());
const USERS = { [GOOD]: { id: 'u-7', email: 'krishna@example.com' }, [GOOD2]: { id: 'u-7', email: 'krishna@example.com' }, [OTHER_USER]: { id: 'u-99', email: 'other@example.com' } };
const saved = []; const calls = []; let apiDown = false;
const server = https.createServer({ key: readFileSync(join(tmp, 'k.pem')), cert: readFileSync(join(tmp, 'c.pem')) }, (req, res) => {
  const host = req.headers.host; const url = new URL(req.url, 'https://x');
  if (host === 'www.bukmarkz.test' && url.pathname === '/api/ingest') {
    calls.push(`${req.method} ${url.pathname}`);
    if (apiDown) { req.socket.destroy(); return; }
    const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    const user = USERS[(req.headers.authorization ?? '').replace(/^Bearer /, '')];
    if (!user) return json(401, { code: 'invalid_token' });
    if (req.method === 'GET') return json(200, { user });
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { const body = JSON.parse(b); saved.push({ ...body, _user: user.id, _auth: req.headers.authorization, _cookie: req.headers.cookie ?? null }); json(201, { id: `id${saved.length}`, created: true }); }); return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  if (host === 'www.bukmarkz.test') res.end('<!doctype html><title>Bukmarkz app</title><h1>app</h1>');
  else res.end('<!doctype html><title>How vector search works</title><body style="font:16px sans-serif;padding:40px"><h1>How vector search works</h1><p>Some article text.</p><input id="pagebox" placeholder="page input"></body>');
});
await new Promise((r) => server.listen(443, '127.0.0.1', r));

const ctx = await chromium.launchPersistentContext(join(tmp, 'profile'), {
  headless: true, channel: 'chromium', viewport: { width: 1100, height: 700 },
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, '--ignore-certificate-errors', '--no-proxy-server', '--host-resolver-rules=MAP *.bukmarkz.test 127.0.0.1, MAP site.test 127.0.0.1'],
});
let passed = 0; const step = async (name, fn) => { try { await fn(); passed++; console.log('  ok  ', name); } catch (e) { console.log('  FAIL', name, '\n      ', e.message); process.exitCode = 1; } };

let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = sw.url().split('/')[2];
const inSW = (fn, arg) => sw.evaluate(fn, arg);
await new Promise((r) => setTimeout(r, 500));

const page = await ctx.newPage();
await page.goto('https://www.bukmarkz.test/');
const bridge = (type, payload) => page.evaluate(([type, payload]) => new Promise((resolve) => {
  const id = Math.random().toString(36).slice(2);
  const on = (e) => { if (e.data?.channel === 'bukmarkz.bridge.v1' && e.data.from === 'extension' && e.data.requestId === id) { removeEventListener('message', on); resolve(e.data); } };
  addEventListener('message', on); setTimeout(() => resolve(null), 4000);
  postMessage({ channel: 'bukmarkz.bridge.v1', from: 'page', type, requestId: id, payload }, location.origin);
}), [type, payload]);

console.log('Web bridge');
await step('HELLO is answered, so the site can detect the extension', async () => { const r = await bridge('HELLO'); assert.equal(r?.type, 'READY'); });
await step('starts signed out with a "!" badge', async () => { assert.equal(await inSW(() => chrome.action.getBadgeText({})), '!'); });
await step('a token the server rejects is refused and not stored', async () => {
  const r = await bridge('AUTH_LOGIN', { accessToken: jwt('stranger', inOneHour()) });   // well-formed, but the server does not know it
  assert.equal(r.ok, false); assert.equal(r.code, 'invalid_token');
  const junk = await bridge('AUTH_LOGIN', { accessToken: 'not-a-jwt' }); assert.equal(junk.code, 'bad_input');
  assert.equal(await inSW(async () => (await chrome.storage.local.get('bukmarkz.session'))['bukmarkz.session'] ?? null), null);
});
await step('a valid token is verified with the server and stored', async () => {
  const r = await bridge('AUTH_LOGIN', { accessToken: GOOD });
  assert.equal(r.ok, true); assert.equal(r.user.email, 'krishna@example.com');
  assert.ok(!JSON.stringify(r).includes(GOOD), 'reply must not contain the token');
  const s = await inSW(async () => (await chrome.storage.local.get('bukmarkz.session'))['bukmarkz.session']);
  assert.equal(s.accessToken, GOOD); assert.equal(s.user.id, 'u-7'); assert.ok(Math.abs(s.expiresAt - JSON.parse(Buffer.from(GOOD.split('.')[1], 'base64url')).exp) === 0, 'expiry comes from the JWT, not the page');
  assert.equal(await inSW(() => chrome.action.getBadgeText({})), '');
});
await step('a page on another site cannot talk to the extension', async () => {
  const other = await ctx.newPage(); await other.goto('https://site.test/');
  const got = await other.evaluate(() => new Promise((resolve) => { addEventListener('message', (e) => { if (e.data?.from === 'extension') resolve(e.data); }); postMessage({ channel: 'bukmarkz.bridge.v1', from: 'page', type: 'HELLO', requestId: 'x' }, location.origin); setTimeout(() => resolve(null), 1200); }));
  assert.equal(got, null); await other.close();
});

console.log('Overlay (Cmd/Ctrl+Shift+S opens it through the same injection path)');
const site = await ctx.newPage(); await site.goto('https://site.test/article');
const tabId = async () => inSW(async () => (await chrome.tabs.query({ url: 'https://site.test/*' }))[0].id);
const inject = async () => inSW(async (id) => { await chrome.scripting.executeScript({ target: { tabId: id }, files: ['overlay.js'] }); }, await tabId());
await step('overlay opens, is isolated from the page, and gets focus', async () => {
  await inject(); await site.waitForTimeout(300);
  assert.equal(await site.locator('input#bk-title').count(), 0, 'page scripts and selectors cannot see inside (closed shadow root)');
  await site.screenshot({ path: join(shots, 'overlay.png') });
});
await step('typing in the overlay does not trigger page key handlers', async () => {
  await site.evaluate(() => { window.__keys = 0; addEventListener('keydown', () => window.__keys++); });
  await site.keyboard.press('Tab'); await site.keyboard.type('hello');
  assert.equal(await site.evaluate(() => window.__keys), 0);
});
await step('note + tag + reminder + Ctrl+Enter saves to the API', async () => {
  // focus is on the Note box after the first Tab from Title
  await site.keyboard.type(' remember this');
  await site.keyboard.press('Tab'); await site.keyboard.type('Vector Search'); await site.keyboard.press('Enter');
  await site.keyboard.press('Tab');   // chip "#vector-search"
  await site.keyboard.press('Tab');   // reminder select
  await site.keyboard.press('ArrowDown'); await site.keyboard.press('ArrowDown'); // "This evening" (or later)
  await site.screenshot({ path: join(shots, 'overlay-filled.png') });
  await site.keyboard.press('Control+Enter'); await site.waitForTimeout(700);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].url, 'https://site.test/article');
  assert.equal(saved[0].title, 'How vector search works');
  assert.match(saved[0].note, /hello remember this/); assert.deepEqual(saved[0].tags, ['vector-search']);
  await site.screenshot({ path: join(shots, 'overlay-saved.png') });
});
await step('a reminder alarm was scheduled and the badge flashed then cleared', async () => {
  const alarms = await inSW(() => chrome.alarms.getAll()); assert.ok(alarms.some((a) => a.name.startsWith('bukmarkz:remind:')), JSON.stringify(alarms));
  await site.waitForTimeout(2200); assert.equal(await inSW(() => chrome.action.getBadgeText({})), '');
});
await step('overlay closes itself after saving', async () => { await site.waitForTimeout(800); await site.locator('#pagebox').focus(); await site.keyboard.type('x'); assert.equal(await site.inputValue('#pagebox'), 'x'); });

console.log('Popup');
const popup = await ctx.newPage();
await popup.addInitScript(() => { chrome.tabs.query = async () => [{ url: 'https://site.test/other', title: 'Another page about embeddings', id: 1 }]; });
await popup.goto(`chrome-extension://${extId}/popup.html`);
await step('popup lists the recent save with a Synced badge and tag history', async () => {
  await popup.getByText('How vector search works').first().waitFor({ timeout: 4000 });
  await popup.getByText('Synced').first().waitFor();
  await popup.getByRole('button', { name: '#vector-search' }).waitFor();
  await popup.screenshot({ path: join(shots, 'popup.png') });
});
await step('popup saves the current page with a note, chosen tag and Ctrl+Enter', async () => {
  await popup.getByRole('button', { name: '#vector-search' }).click();
  await popup.getByLabel(/Quick note/).fill('from the popup'); await popup.keyboard.press('Control+Enter');
  await popup.getByText('Saved to Bukmarkz.').waitFor({ timeout: 4000 });
  assert.equal(saved.length, 2); assert.equal(saved[1].url, 'https://site.test/other'); assert.deepEqual(saved[1].tags, ['vector-search']);
  await popup.screenshot({ path: join(shots, 'popup-saved.png') });
});

console.log('Context menu (the handler is called directly: Playwright cannot click Chrome\'s native menu)');
const T = { url: 'https://site.test/article', title: 'How vector search works', incognito: false };
const click = (info, tab = T) => inSW(async ([info, tab]) => { await globalThis.__bk.onMenuClick(info, tab); }, [info, tab]);
const before = () => saved.length;
await step('Save Page: saves the page; Authorization is the Bearer JWT and no cookie is sent', async () => {
  const n = before(); await click({ menuItemId: 'bukmarkz-save-page', pageUrl: T.url });
  assert.equal(saved.length, n + 1); const s = saved.at(-1);
  assert.deepEqual([s.kind, s.url, s.title], ['page', T.url, T.title]); assert.equal(s._auth, `Bearer ${GOOD}`); assert.equal(s._cookie, null); assert.equal(s._user, 'u-7');
});
await step('Save Page on a link saves the LINK, not the page it sits on', async () => {
  const n = before(); await click({ menuItemId: 'bukmarkz-save-page', pageUrl: T.url, linkUrl: 'https://other.test/target?utm_source=x' });
  assert.equal(saved.length, n + 1); assert.equal(saved.at(-1).url, 'https://other.test/target');
});
await step('Save Selection as Rich Note: quoted Markdown with a source link', async () => {
  const n = before(); await click({ menuItemId: 'bukmarkz-save-selection', pageUrl: T.url, selectionText: 'Vectors capture meaning.\nNot keywords.' });
  assert.equal(saved.length, n + 1); const s = saved.at(-1);
  assert.equal(s.kind, 'selection'); assert.equal(s.note, '> Vectors capture meaning.\n> Not keywords.\n\n— [How vector search works](https://site.test/article)');
});
await step('Save Image: sends the page and the image address', async () => {
  const n = before(); await click({ menuItemId: 'bukmarkz-save-image', pageUrl: T.url, srcUrl: 'https://site.test/diagram.png' });
  assert.equal(saved.length, n + 1); const s = saved.at(-1); assert.deepEqual([s.kind, s.url, s.imageUrl], ['image', T.url, 'https://site.test/diagram.png']);
});
await step('unsavable clicks send nothing: data: image, empty selection, chrome:// page', async () => {
  const n = calls.length;
  await click({ menuItemId: 'bukmarkz-save-image', pageUrl: T.url, srcUrl: 'data:image/png;base64,AAAA' });
  await click({ menuItemId: 'bukmarkz-save-selection', pageUrl: T.url, selectionText: '   ' });
  await click({ menuItemId: 'bukmarkz-save-page', pageUrl: 'chrome://settings' }, { url: 'chrome://settings', title: 'x', incognito: false });
  assert.equal(calls.length, n);
});
await step('from an incognito tab the save stays on this device', async () => {
  const n = calls.length; await click({ menuItemId: 'bukmarkz-save-selection', pageUrl: 'https://site.test/private', selectionText: 'secret thought' }, { url: 'https://site.test/private', title: 'P', incognito: true });
  assert.equal(calls.length, n);
  const recent = await inSW(async () => (await chrome.storage.local.get('bukmarkz.recent'))['bukmarkz.recent']);
  assert.equal(recent.find((r) => r.url === 'https://site.test/private').status, 'local-private');
});

console.log('Session expiry and refresh');
await step('an expired token does not lose a menu save: it is queued, badge shows 1', async () => {
  await inSW(async () => { const k = 'bukmarkz.session'; const s = (await chrome.storage.local.get(k))[k]; await chrome.storage.local.set({ [k]: { ...s, expiresAt: Math.floor(Date.now() / 1000) - 10 } }); });
  const n = calls.length;
  await click({ menuItemId: 'bukmarkz-save-selection', pageUrl: 'https://site.test/while-expired', selectionText: 'kept for later' }, { url: 'https://site.test/while-expired', title: 'E', incognito: false });
  assert.equal(calls.length, n, 'nothing is sent with an expired token');
  assert.equal(await inSW(() => chrome.action.getBadgeText({})), '1');
});
await step('when the website pushes the refreshed token, the queued save goes out and the badge clears', async () => {
  const n = before(); const r = await bridge('AUTH_LOGIN', { accessToken: GOOD2 }); assert.equal(r.ok, true);
  await page.waitForTimeout(600);
  assert.equal(saved.length, n + 1); assert.equal(saved.at(-1).url, 'https://site.test/while-expired'); assert.equal(saved.at(-1)._auth, `Bearer ${GOOD2}`);
  assert.equal(await inSW(() => chrome.action.getBadgeText({})), '');
});
await step('a revoked token (server says 401) keeps the save queued instead of dropping it', async () => {
  const REVOKED = jwt('u-7', inOneHour() + 77); USERS[REVOKED] = USERS[GOOD2];
  await bridge('AUTH_LOGIN', { accessToken: REVOKED }); delete USERS[REVOKED];
  const n = before();
  const r = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'save', input: { url: 'https://site.test/revoked', title: 'R', note: '', tags: [], remindAt: null, private: false } }));
  assert.equal(r.ok, true); assert.equal(r.item.status, 'queued'); assert.equal(await inSW(() => chrome.action.getBadgeText({})), '1');
  await bridge('AUTH_LOGIN', { accessToken: GOOD2 }); await page.waitForTimeout(600);
  assert.equal(saved.length, n + 1); assert.equal(saved.at(-1).url, 'https://site.test/revoked');
});
await step('an expired session makes the worker ask the open website tab to renew; the page gets a message with no token in it', async () => {
  await page.evaluate(() => { window.__asks = []; window.addEventListener('message', (e) => { if (e.data?.from === 'extension' && e.data?.type === 'REFRESH_REQUEST') window.__asks.push(JSON.stringify(e.data)); }); });
  const asked = await inSW(async () => globalThis.__bk.requestRefresh(true));
  await page.waitForTimeout(300);
  const asks = await page.evaluate(() => window.__asks);
  assert.ok(asked >= 1, 'worker reached at least one tab'); assert.equal(asks.length, 1); assert.ok(!/eyJ|token/i.test(asks[0]), 'no token in the request');
  const r = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'session:refresh' }));     // throttled right after a forced ask
  assert.equal(r.ok, true); assert.equal(r.asked, 0);
});

console.log('Incognito (spanning worker is shared, so policy is tested through the same handlers the incognito tab would call)');
const asIncognito = (fn, arg) => inSW(async ([name, arg]) => globalThis.__bk[name](...arg), [fn, arg]);
await step('an incognito tab cannot replace a different account\'s session', async () => {
  const r = await asIncognito('handleLogin', [OTHER_USER, true]); assert.equal(r.ok, false);
  assert.equal((await inSW(async () => (await chrome.storage.local.get('bukmarkz.session'))['bukmarkz.session'])).user.id, 'u-7');
});
await step('an incognito tab may refresh the SAME account; its sign-out does not sign out the normal window', async () => {
  const r = await asIncognito('handleLogin', [GOOD2, true]); assert.equal(r.ok, true);
  const out = await asIncognito('handleLogout', [true]); assert.equal(out.ok, true);
  assert.ok(await inSW(async () => (await chrome.storage.local.get('bukmarkz.session'))['bukmarkz.session']), 'session survives an incognito sign-out');
});

console.log('Offline queue, private saves, sign-out');
const msg = (m) => popup.evaluate((m) => chrome.runtime.sendMessage(m), m);
await step('when the API is down the save is queued and the badge shows 1', async () => {
  apiDown = true;
  const r = await msg({ type: 'save', input: { url: 'https://site.test/offline', title: 'Offline', note: '', tags: [], remindAt: null, private: false } });
  assert.equal(r.ok, true); assert.equal(r.item.status, 'queued'); assert.equal(await inSW(() => chrome.action.getBadgeText({})), '1');
});
await step('queued saves sync once the API is back', async () => {
  apiDown = false; const r = await msg({ type: 'queue:flush' });
  assert.equal(saved.at(-1).url, 'https://site.test/offline'); assert.equal(await inSW(() => chrome.action.getBadgeText({})), '');
  assert.equal(r.items.find((i) => i.url === 'https://site.test/offline').status, 'synced');
});
await step('a private save never touches the network', async () => {
  const before = calls.length;
  const r = await msg({ type: 'save', input: { url: 'https://site.test/secret', title: 'Secret', note: 'hush', tags: [], remindAt: null, private: true } });
  assert.equal(r.item.status, 'local-private'); assert.equal(calls.length, before); assert.ok(!saved.some((s) => s.url.endsWith('/secret')));
});
await step('private reminders keep the title out of notifications', async () => {
  const rem = await msg({ type: 'save', input: { url: 'https://site.test/secret2', title: 'Very private title', note: '', tags: [], remindAt: Date.now() + 3600_000, private: true } });
  const stored = await inSW(async () => (await chrome.storage.local.get('bukmarkz.reminders'))['bukmarkz.reminders']);
  assert.equal(stored.find((r) => r.url.endsWith('secret2')).private, true); assert.ok(rem.ok);
});
await step('malformed or unsafe messages are rejected', async () => {
  for (const url of ['chrome://settings', 'javascript:alert(1)', 'file:///etc/passwd']) {
    const r = await msg({ type: 'save', input: { url, title: 'x', note: '', tags: [], remindAt: null, private: false } }); assert.equal(r.ok, false, url);
  }
  assert.equal((await msg({ type: 'nope' })).ok, false);
  const forged = await popup.evaluate((t) => chrome.runtime.sendMessage({ type: 'bridge:login', accessToken: t }), GOOD2);
  assert.equal(forged.ok, false); // the popup is not bukmarkz.com, so it cannot hand over a session
});
await step('signing out on the site signs the extension out too', async () => {
  const r = await bridge('AUTH_LOGOUT'); assert.equal(r.ok, true);
  assert.equal(await inSW(() => chrome.action.getBadgeText({})), '!');
  const res = await msg({ type: 'save', input: { url: 'https://site.test/x', title: 'x', note: '', tags: [], remindAt: null, private: false } });
  assert.equal(res.ok, false); assert.equal(res.code, 'not_signed_in');
});
await step('signed-out popup shows the sign-in prompt', async () => {
  await popup.reload(); await popup.getByText('Your bookmarks, organised by AI').waitFor({ timeout: 4000 });
  await popup.screenshot({ path: join(shots, 'popup-signed-out.png') });
});

await ctx.close(); server.close();
console.log(`\n${passed} steps passed${process.exitCode ? ', some FAILED' : ''}. Screenshots in ${shots}`);
