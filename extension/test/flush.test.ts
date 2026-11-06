import test from 'node:test';
import assert from 'node:assert/strict';
import { flushSession, pickTabs, type FlushDeps, type FlushTab } from '../src/shared/flush';

const T = (id: number, url: string, o: Partial<FlushTab> = {}): FlushTab => ({ id, url, title: 'T' + id, favIconUrl: `https://${id}.example/f.ico`, ...o });
function rig(tabs: FlushTab[], reply: { status?: number; body?: unknown; throws?: boolean } = {}, over: Partial<FlushDeps> = {}) {
  const log = { opened: [] as string[], closed: [] as number[][], posts: [] as { url: string; init: RequestInit }[], queries: [] as unknown[] };
  const deps: FlushDeps = {
    queryTabs: async (q) => { log.queries.push(q); return tabs; },
    openTab: async (u) => { log.opened.push(u); }, closeTabs: async (ids) => { log.closed.push(ids); },
    token: async () => 'jwt-abc', hasTabsPermission: async () => true,
    fetch: (async (url: string, init: RequestInit) => {
      log.posts.push({ url, init });
      if (reply.throws) throw new Error('offline');
      return new Response(JSON.stringify(reply.body ?? { ok: true, id: 'sid', url: 'https://bukmarkz.com/s/sid', tabCount: 2 }), { status: reply.status ?? 201 });
    }) as typeof fetch,
    ...over,
  };
  return { deps, log };
}
const WEB = [T(1, 'https://a.example/x'), T(2, 'https://b.example/y'), T(9, 'https://bukmarkz.com/dashboard', { active: true })];

test('saves every normal tab, sends the bearer token, closes them, keeps the dashboard', async () => {
  const { deps, log } = rig(WEB);
  const r = await flushSession(deps, 5);
  assert.equal(r.ok, true);
  assert.deepEqual(log.closed, [[1, 2]]);
  assert.deepEqual(log.queries, [{ windowId: 5 }]);
  const sent = JSON.parse(String(log.posts[0].init.body));
  assert.equal(sent.tabs.length, 2);
  assert.deepEqual(Object.keys(sent.tabs[0]).sort(), ['favicon', 'title', 'url']);
  assert.equal((log.posts[0].init.headers as Record<string, string>).Authorization, 'Bearer jwt-abc');
  assert.equal(log.posts[0].init.credentials, 'omit');
  assert.equal(log.posts[0].url, 'https://www.bukmarkz.com/api/vault/session');
  assert.deepEqual(log.opened, [], 'dashboard tab survives, so no extra tab is opened');
});
test('uses currentWindow when no window id is given', async () => {
  const { deps, log } = rig(WEB); await flushSession(deps);
  assert.deepEqual(log.queries, [{ currentWindow: true }]);
});
test('NEVER closes anything when the server fails (5xx, 4xx, offline, malformed, ok:false)', async () => {
  for (const reply of [{ status: 500, body: {} }, { status: 400, body: {} }, { throws: true }, { status: 200, body: { nope: 1 } }, { status: 201, body: { ok: false } }, { status: 201, body: { ok: true, id: 'x' } }]) {
    const { deps, log } = rig(WEB, reply); const r = await flushSession(deps);
    assert.equal(r.ok, false); assert.deepEqual(log.closed, []); assert.deepEqual(log.opened, []);
    if (!r.ok) assert.match(r.message, /tabs were not touched/);
  }
});
test('429 and 401 map to clear errors and close nothing', async () => {
  let r = await flushSession(rig(WEB, { status: 429, body: {} }).deps); assert.equal(!r.ok && r.error, 'rate_limited');
  const x = rig(WEB, { status: 401, body: {} }); r = await flushSession(x.deps); assert.equal(!r.ok && r.error, 'not_signed_in'); assert.deepEqual(x.log.closed, []);
});
test('signed out / missing permission: no request, no change', async () => {
  const a = rig(WEB, {}, { token: async () => null }); const ra = await flushSession(a.deps);
  assert.equal(!ra.ok && ra.error, 'not_signed_in'); assert.equal(a.log.posts.length, 0);
  const b = rig(WEB, {}, { hasTabsPermission: async () => false }); const rb = await flushSession(b.deps);
  assert.equal(!rb.ok && rb.error, 'permission'); assert.equal(b.log.posts.length, 0);
});
test('incognito windows are refused before anything leaves the browser', async () => {
  const { deps, log } = rig([T(1, 'https://a.example', { incognito: true })]); const r = await flushSession(deps);
  assert.equal(!r.ok && r.error, 'incognito'); assert.equal(log.posts.length, 0);
});
test('internal pages are neither uploaded nor closed; pinned tabs are uploaded but kept', async () => {
  const tabs = [T(1, 'chrome://settings'), T(2, 'file:///etc/passwd'), T(3, 'about:blank'), T(4, 'https://ok.example/p'), T(5, 'https://pinned.example/', { pinned: true }), T(6, 'javascript:alert(1)')];
  const { deps, log } = rig(tabs); const r = await flushSession(deps);
  const sent = JSON.parse(String(log.posts[0].init.body)).tabs.map((t: any) => t.url);
  assert.deepEqual(sent, ['https://ok.example/p', 'https://pinned.example/']);
  assert.deepEqual(log.closed, [[4]]);
  assert.equal(r.ok && r.kept, 5);
});
test('if every tab would close, the session page is opened first so the window survives', async () => {
  const { deps, log } = rig([T(1, 'https://a.example'), T(2, 'https://b.example')]); const r = await flushSession(deps);
  assert.equal(r.ok, true); assert.deepEqual(log.opened, ['https://bukmarkz.com/s/sid']); assert.deepEqual(log.closed, [[1, 2]]);
});
test('a reply pointing at another origin is never opened or trusted', async () => {
  const { deps, log } = rig([T(1, 'https://a.example')], { body: { ok: true, id: 'x', url: 'https://evil.example/s/x' } }); const r = await flushSession(deps);
  assert.equal(r.ok, false); assert.deepEqual(log.closed, []); assert.deepEqual(log.opened, []);
});
test('nothing savable: no request', async () => {
  const { deps, log } = rig([T(1, 'https://bukmarkz.com/'), T(2, 'chrome://newtab')]); const r = await flushSession(deps);
  assert.equal(!r.ok && r.error, 'nothing'); assert.equal(log.posts.length, 0);
});
test('only https favicons are forwarded', () => {
  const p = pickTabs([T(1, 'https://a.example', { favIconUrl: 'http://x/i.ico' }), T(2, 'https://b.example', { favIconUrl: 'data:image/png;base64,AAAA' }), T(3, 'https://c.example', { favIconUrl: 'https://c.example/i.ico' })]);
  assert.deepEqual(p.map((t) => t.favicon), [null, null, 'https://c.example/i.ico']);
});
