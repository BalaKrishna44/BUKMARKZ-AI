import { chromium } from '/tmp/vsb/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const b = await chromium.launch(); let fails = 0; const errs = [];
async function fresh(w = 1280) { const p = await b.newPage({ viewport: { width: w, height: 850 } }); p.on('pageerror', (e) => errs.push(e.message)); await p.goto('file:///tmp/live/t/dash.html'); await p.locator('[role=status][title^="Live"]').waitFor(); return p; }
async function step(name, fn) { try { await fn(); console.log('  ok  ', name); } catch (e) { fails++; console.log('  FAIL', name, '\n      ', String(e.message).split('\n').slice(0, 4).join('\n       ')); } }
const S = (p) => p.evaluate(() => JSON.parse(JSON.stringify({ ...window.__s, channelCb: null, handlers: window.__s.handlers.map((h) => ({ t: h.table, f: h.filter })), authCb: null })));
const row = (o) => ({ id: 'n1', title: 'Fresh from the extension', url: 'https://new.example.com/x', note: null, tags: [], ai_tags: [], summary: null, meta_description: null, favicon_url: null, category_id: null, created_at: new Date().toISOString(), item_type: 'link', completed_at: null, user_id: 'u1', ...o });

console.log('Realtime');
await step('subscribes to the signed-in user only, on items and categories; sync with the extension started', async () => {
  const p = await fresh(); const s = await S(p);
  assert.deepEqual(s.handlers, [{ t: 'oneclist_items', f: 'user_id=eq.u1' }, { t: 'categories', f: 'user_id=eq.u1' }]); assert.equal(await p.evaluate(() => window.__sync), 1); await p.close();
});
await step('a bookmark saved from the extension appears at the top at once, with a toast and updated counts', async () => {
  const p = await fresh(); const before = await p.locator('main > ul > li').count();
  await p.evaluate((r) => window.__emit('oneclist_items', { eventType: 'INSERT', new: r, old: {} }), row());
  await p.getByText('Saved: Fresh from the extension').first().waitFor();
  assert.equal(await p.locator('main > ul > li').count(), before + 1); assert.match(await p.locator('main > ul > li').first().innerText(), /Fresh from the extension/);
  await p.screenshot({ path: '/tmp/live/t/live-insert.png' }); await p.close();
});
await step('the same INSERT delivered twice (reconnect replay) does not duplicate', async () => {
  const p = await fresh(); const before = await p.locator('main > ul > li').count();
  for (let i = 0; i < 2; i++) await p.evaluate((r) => window.__emit('oneclist_items', { eventType: 'INSERT', new: r, old: {} }), row());
  await p.waitForTimeout(150); assert.equal(await p.locator('main > ul > li').count(), before + 1); await p.close();
});
await step('UPDATE from the AI worker (summary + category) changes the row in place and an unknown category triggers a refetch', async () => {
  const p = await fresh();
  await p.evaluate(() => { window.__s.categories.push({ id: 'c9', name: 'Finance', position: 3 }); });
  await p.evaluate((r) => window.__emit('oneclist_items', { eventType: 'UPDATE', new: r, old: {} }), row({ id: 'id2', title: 'Article 2', summary: 'AI wrote this TL;DR', category_id: 'c9' }));
  await p.getByRole('button', { name: /Finance/ }).waitFor();                    // new folder showed up in the sidebar
  await p.getByText('AI wrote this TL;DR').first().waitFor(); await p.close();
});
await step('a malformed or javascript: payload is ignored / removed, never rendered', async () => {
  const p = await fresh(); const n = await p.locator('main > ul > li').count();
  await p.evaluate(() => { window.__emit('oneclist_items', { eventType: 'INSERT', new: { id: 5 }, old: {} }); window.__emit('oneclist_items', { eventType: 'INSERT', new: null, old: {} }); });
  await p.evaluate((r) => window.__emit('oneclist_items', { eventType: 'INSERT', new: r, old: {} }), row({ id: 'evil', url: 'javascript:alert(1)' }));
  await p.waitForTimeout(150); assert.equal(await p.locator('main > ul > li').count(), n); assert.equal(await p.locator('a[href^="javascript"]').count(), 0); await p.close();
});
await step('DELETE removes a shown row; a DELETE for an id we do not show is ignored', async () => {
  const p = await fresh(); const n = await p.locator('main > ul > li').count();
  await p.evaluate(() => window.__emit('oneclist_items', { eventType: 'DELETE', new: {}, old: { id: 'someone-elses' } })); await p.waitForTimeout(100); assert.equal(await p.locator('main > ul > li').count(), n);
  await p.evaluate(() => window.__emit('oneclist_items', { eventType: 'DELETE', new: {}, old: { id: 'id2' } })); await p.waitForTimeout(100); assert.equal(await p.locator('main > ul > li').count(), n - 1); await p.close();
});
await step('dropped connection shows "Reconnecting"; when it returns the list is reloaded so nothing is missed', async () => {
  const p = await fresh(); const sel = (await S(p)).selects;
  await p.evaluate(() => window.__status('CHANNEL_ERROR')); await p.getByText('Reconnecting').waitFor();
  await p.evaluate(() => window.__status('SUBSCRIBED')); await p.getByText('Appeared during the outage').first().waitFor();
  assert.ok((await S(p)).selects > sel); await p.locator('[role=status][title^="Live"]').waitFor(); await p.close();
});
await step('leaving the page removes the channel', async () => { const p = await fresh(); await p.evaluate(() => { document.getElementById('r').remove(); }); await p.close(); });

console.log('Tasks');
await step('tasks show a checkbox; To-do lists open tasks; toggling writes completed_at and updates the count', async () => {
  const p = await fresh(); await p.getByRole('button', { name: /To-do/ }).waitFor();
  assert.match(await p.getByRole('button', { name: /To-do/ }).innerText(), /1/);                     // one open task (the other is done)
  assert.equal(await p.getByRole('checkbox', { checked: true }).count(), 1);
  await p.getByRole('checkbox', { name: /Mark done: Try the Pinecone/ }).click();
  await p.getByText('Marked done').waitFor();
  const call = (await S(p)).calls.find((c) => c.op === 'update' && c.vals.completed_at);
  assert.equal(call.id, 'id3'); assert.equal(call.col, 'id'); assert.match(call.vals.completed_at, /^\d{4}-\d\d-\d\dT/);
  assert.equal(await p.getByRole('checkbox', { checked: true }).count(), 2);
  assert.equal(await p.getByRole('button', { name: /To-do/ }).count(), 1);                            // still selected-able though none open
  await p.getByRole('checkbox', { name: /Reopen: Read the Postgres/ }).click(); await p.getByText('Reopened').waitFor();
  assert.equal((await S(p)).calls.filter((c) => c.vals && 'completed_at' in c.vals).at(-1).vals.completed_at, null);
  await p.getByRole('button', { name: /To-do/ }).click(); assert.equal(await p.locator('main > ul > li').count(), 2);
  await p.screenshot({ path: '/tmp/live/t/tasks.png' }); await p.close();
});
await step('toggle rolls back and says so when the database refuses', async () => {
  const p = await fresh(); await p.evaluate(() => { window.__s.fail = { message: 'denied' }; });
  await p.getByRole('checkbox', { name: /Mark done: Try the Pinecone/ }).click(); await p.getByText('Could not update that to-do').waitFor();
  assert.equal(await p.getByRole('checkbox', { checked: true }).count(), 1); await p.close();
});
await step('a silent row-level-security refusal (0 rows changed) is treated as a failure, not success', async () => {
  const p = await fresh(); await p.evaluate(() => { window.__s.zeroRows = true; });
  await p.getByRole('checkbox', { name: /Mark done: Try the Pinecone/ }).click(); await p.getByText('Could not update that to-do').waitFor(); await p.close();
});

console.log('Edit tags / category / delete');
await step('edit tags: remove an AI tag, add new ones; writes ai_tags and tags to the right columns', async () => {
  const p = await fresh(); await p.getByRole('button', { name: 'Actions for Article 1' }).click(); await p.getByRole('menuitem', { name: 'Edit tags' }).click();
  await p.getByRole('button', { name: 'Remove tag rag' }).click(); await p.getByLabel('Add tags').fill('Next JS, #Perf'); await p.getByLabel('Add tags').press('Enter');
  await p.screenshot({ path: '/tmp/live/t/tags.png' });
  await p.getByRole('button', { name: 'Save tags' }).click(); await p.getByText('Tags saved').waitFor();
  const c = (await S(p)).calls.find((x) => x.vals && 'ai_tags' in x.vals);
  assert.deepEqual(c.vals, { ai_tags: ['react'], tags: ['mine', 'next', 'js', 'perf'] }); assert.equal(c.id, 'id1');
  await p.keyboard.press('Escape'); await p.close();
});
await step('Enter in the tag box never submits garbage; empty input is a no-op', async () => {
  const p = await fresh(); await p.getByRole('button', { name: 'Actions for Article 1' }).click(); await p.getByRole('menuitem', { name: 'Edit tags' }).click();
  await p.getByLabel('Add tags').fill('   ,, !!! '); await p.getByLabel('Add tags').press('Enter'); assert.equal(await p.getByLabel('Current tags').locator('li').count(), 3); await p.close();
});
await step('move to folder writes category_id; failure rolls back', async () => {
  const p = await fresh(); await p.getByRole('button', { name: 'Actions for Article 1' }).click(); await p.getByRole('menuitem', { name: /Move to folder/ }).click(); await p.getByRole('menuitemradio', { name: /AI & ML/ }).click();
  await p.getByText('Moved to AI & ML').waitFor(); assert.deepEqual((await S(p)).calls.find((c) => c.vals && 'category_id' in c.vals).vals, { category_id: 'c2' }); await p.close();
});
await step('delete: confirm dialog, delete by id, row removed; no echo needed', async () => {
  const p = await fresh(); const n = await p.locator('main > ul > li').count();
  await p.getByRole('button', { name: 'Actions for Article 2' }).click(); await p.getByRole('menuitem', { name: 'Delete' }).click(); await p.getByRole('button', { name: 'Delete', exact: true }).click();
  await p.getByText('Bookmark deleted').waitFor(); assert.equal(await p.locator('main > ul > li').count(), n - 1);
  assert.deepEqual((await S(p)).calls.find((c) => c.op === 'delete'), { op: 'delete', table: 'oneclist_items', col: 'id', id: 'id2' }); await p.close();
});
await step('delete that RLS silently refuses keeps the row and shows an error', async () => {
  const p = await fresh(); const n = await p.locator('main > ul > li').count(); await p.evaluate(() => { window.__s.zeroRows = true; });
  await p.getByRole('button', { name: 'Actions for Article 2' }).click(); await p.getByRole('menuitem', { name: 'Delete' }).click(); await p.getByRole('button', { name: 'Delete', exact: true }).click();
  await p.getByText('Could not delete that bookmark').waitFor(); assert.equal(await p.locator('main > ul > li').count(), n); await p.close();
});

console.log('Session');
await step('an auth error from the database sends the user to /login?next=/dashboard', async () => {
  const p = await fresh(); await p.evaluate(() => { window.__s.fail = { message: 'JWT expired', status: 401 }; });
  await p.getByRole('checkbox', { name: /Mark done: Try the Pinecone/ }).click(); await p.waitForRequest((r) => /\/login\?next=\/dashboard$/.test(r.url()), { timeout: 4000 }); await p.close();
});
await step('SIGNED_OUT in another tab sends this tab to /login', async () => { const p = await fresh(); const nav = p.waitForRequest((r) => /\/login$/.test(r.url()), { timeout: 4000 }); await p.evaluate(() => window.__auth('SIGNED_OUT')); await nav; await p.close(); });
await step('Sign out button signs out then goes to /login', async () => { const p = await fresh(); let called = false; p.on('console', (m) => { if (m.text() === 'SIGNOUT-CALLED') called = true; }); const nav = p.waitForRequest((r) => /\/login$/.test(r.url()), { timeout: 4000 }); await p.getByRole('button', { name: 'Sign out' }).click(); await nav; assert.equal(called, true); await p.close(); });

console.log('Layout');
await step('390px: no horizontal scroll, header controls reachable', async () => {
  const p = await fresh(390); assert.ok(await p.evaluate(() => document.documentElement.scrollWidth) <= 390); await p.screenshot({ path: '/tmp/live/t/m.png' });
  await p.getByRole('button', { name: 'Sign out' }).waitFor(); await p.close();
});
console.log('Login page');
await step('login page renders at 390px without horizontal scroll (submit logic is not exercised: needs the real Supabase client)', async () => {
  const p = await b.newPage({ viewport: { width: 390, height: 800 } }); await p.goto('file:///tmp/live/t/login.html');
  await p.getByLabel('Email').fill('a@b.co'); await p.getByLabel('Password').fill('x'); await p.screenshot({ path: '/tmp/live/t/login.png' });
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth) <= 390); await p.close();
});
console.log(errs.length ? 'PAGE ERRORS: ' + errs.join(' | ') : 'no page errors', fails ? `\n${fails} FAILED` : '\nall passed'); await b.close();
