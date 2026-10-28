// End-to-end test in a real Chromium with the built extension loaded.
// Needs: playwright, openssl, and permission to bind port 443 (maps *.bukmarkz.test to 127.0.0.1).
//   BUKMARKZ_WEB=https://www.bukmarkz.test BUKMARKZ_API=https://api.bukmarkz.test BUKMARKZ_EXTRA_HOSTS=https://site.test npm run build
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
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(tmp, 'k.pem'), '-out', join(tmp, 'c.pem'), '-days', '2', '-subj', '/CN=bukmarkz.test', '-addext', 'subjectAltName=DNS:www.bukmarkz.test,DNS:api.bukmarkz.test,DNS:site.test'], { stdio: 'ignore' });

/* ---- fake Bukmarkz web + API ---- */
const GOOD = 'good-token-0123456789abcdef0123456789abcdef';
const saved = []; const calls = []; let apiDown = false;
const server = https.createServer({ key: readFileSync(join(tmp, 'k.pem')), cert: readFileSync(join(tmp, 'c.pem')) }, (req, res) => {
  const host = req.headers.host; const url = new URL(req.url, 'https://x');
  if (host === 'api.bukmarkz.test') {
    calls.push(`${req.method} ${url.pathname}`);
    if (apiDown) { req.socket.destroy(); return; }
    const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.headers.authorization !== `Token ${GOOD}`) return json(401, { detail: 'Invalid token.' });
    if (url.pathname === '/api/auth/user/') return json(200, { id: 7, email: 'krishna@example.com', username: 'krishna' });
    if (url.pathname === '/api/auth/logout/') return json(204, {});
    if (url.pathname === '/api/extension/bookmarks/' && req.method === 'POST') {
      let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { const body = JSON.parse(b); saved.push(body); json(201, { id: saved.length, created: true, ...body }); }); return;
    }
    return json(404, {});
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
  const r = await bridge('AUTH_LOGIN', { token: 'bad-token-0123456789abcdef', expiry: null });
  assert.equal(r.ok, false); assert.equal(r.code, 'invalid_token');
  assert.equal(await inSW(async () => (await chrome.storage.local.get('bukmarkz.session'))['bukmarkz.session'] ?? null), null);
});
await step('a valid token is verified with the server and stored', async () => {
  const r = await bridge('AUTH_LOGIN', { token: GOOD, expiry: new Date(Date.now() + 86400000).toISOString() });
  assert.equal(r.ok, true); assert.equal(r.user.email, 'krishna@example.com');
  assert.ok(!JSON.stringify(r).includes(GOOD), 'reply must not contain the token');
  const s = await inSW(async () => (await chrome.storage.local.get('bukmarkz.session'))['bukmarkz.session']);
  assert.equal(s.token, GOOD); assert.equal(s.user.id, 7);
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
  const forged = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'bridge:login', token: 'x'.repeat(40), expiry: null }));
  assert.equal(forged.ok, false); // the popup is not bukmarkz.com, so it cannot hand over a session
});
await step('signing out on the site signs the extension out too', async () => {
  const r = await bridge('AUTH_LOGOUT'); assert.equal(r.ok, true);
  assert.equal(await inSW(() => chrome.action.getBadgeText({})), '!');
  const res = await msg({ type: 'save', input: { url: 'https://site.test/x', title: 'x', note: '', tags: [], remindAt: null, private: false } });
  assert.equal(res.ok, false); assert.equal(res.code, 'not_signed_in');
});
await step('signed-out popup shows the sign-in prompt', async () => {
  await popup.reload(); await popup.getByText('You are signed out').waitFor({ timeout: 4000 });
  await popup.screenshot({ path: join(shots, 'popup-signed-out.png') });
});

await ctx.close(); server.close();
console.log(`\n${passed} steps passed${process.exitCode ? ', some FAILED' : ''}. Screenshots in ${shots}`);
