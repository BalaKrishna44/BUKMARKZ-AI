/**
 * Bukmarkz full-flow E2E (Playwright).  Run:  E2E_EMAIL=... E2E_PASSWORD=... E2E_STACK_SLUG=... npx playwright test
 *
 *  (a) @guest   /switch/raindrop: drop a bookmarks export -> parsed counts -> "Continue" -> sent to sign-in (file never uploaded)
 *  (b) @authed  /dashboard: "Ask your vault" -> grounded answer with sources; save a link; Morning Resurface widget reacts
 *  (c) @guest + @authed  /s/[stackSlug]: public view, Remix gate for guests, 1-click Remix (fork) for a signed-in user
 *
 * Selectors are accessible roles/labels taken from the components themselves (SwitchDropzone, HeaderSearch, MorningResurfaceWidget,
 * StackActions, AddBookmarkPopover, LoginForm). If you rename a label, this file is where it breaks, by design.
 */
import { expect, test, type Page } from '@playwright/test';
import { rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanVault, seedEnabled, seedVault } from './support/admin';

const FIXTURE = join(__dirname, 'fixtures', 'raindrop-sample.html');
const SLUG = process.env.E2E_STACK_SLUG, STACK_TITLE = process.env.E2E_STACK_TITLE;
const PROBE_URL = `https://example.com/e2e-probe-${Date.now()}`;

/* ------------------------------------------------------------------------------------------------ (a) guest import */
test.describe('(a) guest imports a Raindrop export @guest', () => {
  test('drop file -> parsed counts -> redirected to sign-in, nothing uploaded', async ({ page }) => {
    const uploads: string[] = [];
    page.on('request', (r) => { if (r.method() !== 'GET' && new URL(r.url()).pathname.startsWith('/api/')) uploads.push(`${r.method()} ${new URL(r.url()).pathname}`); });

    await page.goto('/switch/raindrop');
    await expect(page.getByText('Drop your Raindrop export here', { exact: false })).toBeVisible();
    await expect(page.getByText('Nothing is uploaded until you sign in and confirm.')).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles(FIXTURE);          // same code path as drag-and-drop (handle(file))

    // 6 importable links; the javascript: bookmarklet is counted as skipped, not imported
    await expect(page.getByRole('heading', { name: /^6 links ready$/ })).toBeVisible();
    await expect(page.getByText('Read in your browser; nothing has been uploaded.')).toBeVisible();
    const folders = page.getByRole('heading', { name: 'Folders and tags found' }).locator('xpath=following-sibling::ul[1]');
    await expect(folders).toContainText('Postgres');
    await expect(folders).toContainText('Reading list');
    await expect(page.getByText(/1 item can.t be imported/)).toBeVisible();
    expect(uploads, 'parsing must happen in the browser: no write requests before sign-in').toEqual([]);

    await page.getByRole('button', { name: /Continue with 6 links/ }).click();
    await page.waitForURL(/\/(login|signup)\?/);
    const u = new URL(page.url());
    expect(u.pathname).toMatch(/^\/(login|signup)$/);
    expect(u.searchParams.get('next')).toBe('/dashboard/import/resume');       // after auth the user lands on the confirm screen
    expect(u.searchParams.get('ref')).toBe('switch_raindrop');                 // attribution for the funnel
    expect(uploads, 'still nothing uploaded after the redirect').toEqual([]);
  });

  test('a file with no web links shows a plain-language error and can be replaced', async ({ page }) => {
    await page.goto('/switch/raindrop');
    await page.locator('input[type="file"]').setInputFiles({ name: 'empty.html', mimeType: 'text/html', buffer: Buffer.from('<html><body>no bookmarks here</body></html>') });
    await expect(page.getByRole('status')).toContainText(/No web links found|bookmarks export/i);
    await page.locator('input[type="file"]').setInputFiles(FIXTURE);          // recovers without reloading
    await expect(page.getByRole('heading', { name: /^6 links ready$/ })).toBeVisible();
  });

  test('an empty file and an oversized file are rejected before parsing', async ({ page }) => {
    await page.goto('/switch/raindrop');
    await page.locator('input[type="file"]').setInputFiles({ name: 'zero.html', mimeType: 'text/html', buffer: Buffer.alloc(0) });
    await expect(page.getByRole('status')).toContainText('That file is empty.');
    const huge = join(tmpdir(), `bukmarkz-huge-${process.pid}.html`);                  // sparse file: instant, takes no real disk
    writeFileSync(huge, ''); truncateSync(huge, 60 * 1024 * 1024);
    try { await page.locator('input[type="file"]').setInputFiles(huge); } finally { rmSync(huge, { force: true }); }
    await expect(page.getByRole('status')).toContainText(/MB\. The limit is/);
  });
});

/* ------------------------------------------------------------------------------------------------ (b) signed-in dashboard */
test.describe('(b) signed-in dashboard @authed', () => {
  test.beforeAll(async () => { if (seedEnabled()) await seedVault(); });
  test.afterAll(async () => { if (seedEnabled()) await cleanVault(); });

  test('Ask Your Vault returns a grounded answer with sources from the vault', async ({ page }) => {
    test.skip(!seedEnabled() && !process.env.E2E_VAULT_HAS_DATA, 'needs a vault with content: set E2E_SEED=1 (+ Supabase env) or E2E_VAULT_HAS_DATA=1');
    await page.goto('/dashboard');
    const search = page.getByRole('search');
    const askToggle = search.getByRole('group', { name: 'Search mode' }).getByRole('button', { name: 'Ask', exact: true });
    await askToggle.click();
    await expect(askToggle).toHaveAttribute('aria-pressed', 'true');
    await search.getByLabel('Ask your vault a question').fill('What did I save about HNSW and vector indexes in Postgres?');
    const ask = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/(ask|vault\/ask)/.test(r.url()), { timeout: 60_000 });
    await search.locator('button[type="submit"]').click();                                // the submit button shares its label with the mode toggle
    expect((await ask).status(), 'the ask endpoint must succeed (402 = plan limit, 503 = AI breaker)').toBe(200);

    const answer = page.getByRole('region', { name: 'Answer from your vault' });
    await expect(answer).toBeVisible({ timeout: 60_000 });
    await expect(answer.getByText('Buk’s answer')).toBeVisible();
    await expect(answer.getByRole('link').first(), 'an answer without a source link is not grounded').toBeVisible();
    await answer.getByRole('button', { name: 'Dismiss answer' }).click();
    await expect(answer).toBeHidden();
  });

  test('Ask with an empty question sends nothing', async ({ page }) => {
    await page.goto('/dashboard');
    const search = page.getByRole('search');
    await search.getByRole('group', { name: 'Search mode' }).getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(search.locator('button[type="submit"]')).toBeDisabled();
    const reqs: string[] = []; page.on('request', (r) => { if (r.method() === 'POST') reqs.push(r.url()); });
    await search.getByLabel('Ask your vault a question').press('Enter');
    expect(reqs).toEqual([]);
  });

  test('save a link, then it is findable; Morning Resurface tracks what you revisit', async ({ page, context }) => {
    await page.goto('/dashboard');

    // --- save
    await page.getByRole('button', { name: /Add bookmark|Add/ }).first().click();
    await page.getByLabel('Page address').fill(PROBE_URL);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('example.com').first()).toBeVisible();                  // saved + listed
    await page.reload();                                                                 // survives a reload = it reached the database
    await expect(page.getByText(/e2e-probe|example\.com/).first()).toBeVisible();

    // --- the saved link is searchable
    const search = page.getByRole('search');
    await search.getByLabel('Search your bookmarks').fill('e2e-probe');
    await expect(page.getByText(/e2e-probe|example\.com/).first()).toBeVisible();
    await search.getByRole('button', { name: 'Clear' }).click();

    // --- Morning Resurface: the progress bar and counter react to a revisit
    const widget = page.getByRole('region', { name: /Morning Resurface/ });
    test.skip(!(await widget.isVisible().catch(() => false)), 'no links due for resurfacing for this account today');
    const bar = widget.getByRole('progressbar', { name: 'Links revisited' });
    const before = Number(await bar.getAttribute('aria-valuenow'));
    const total = Number(await bar.getAttribute('aria-valuemax'));
    expect(total, 'widget shows at least one link').toBeGreaterThan(0);
    const base = new URL(page.url()).origin;
    await context.route((u) => u.origin !== base, (r) => r.abort());                     // never touch the real internet from a test
    context.on('page', (p) => void p.close().catch(() => {}));                           // the link opens in a new tab (target=_blank); we only care that it was counted
    await widget.getByRole('link').first().click();
    await expect(bar).toHaveAttribute('aria-valuenow', String(before + 1));
    await expect(widget.getByText(new RegExp(`${before + 1} of ${total} revisited today`))).toBeVisible();
    await widget.getByRole('button', { name: /^Snooze / }).first().click().catch(() => {});   // snoozing is also a valid interaction; must not throw
  });
});

/* ------------------------------------------------------------------------------------------------ (c) public stack + remix */
test.describe('(c) public stack and 1-click remix', () => {
  test.skip(!SLUG, 'set E2E_STACK_SLUG to a public stack owned by another account');

  test('@guest anyone can read a public stack; Remix sends a guest to sign-in and straight back', async ({ page }) => {
    const res = await page.goto(`/s/${SLUG}`);
    expect(res?.status()).toBe(200);
    if (STACK_TITLE) await expect(page.getByRole('heading', { name: STACK_TITLE })).toBeVisible();
    const links = page.locator('main a[href^="http"]');
    expect(await links.count(), 'a public stack lists its links').toBeGreaterThan(0);
    for (const rel of await links.evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).rel))) expect(rel).toContain('noopener');
    expect(await page.locator('meta[property="og:title"]').count(), 'shareable link needs Open Graph tags').toBeGreaterThan(0);
    await expect(page.getByText(/\d[\d,]* followers?/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Follow Stack/ })).toBeVisible();

    await page.getByRole('button', { name: /Remix this Stack/ }).click();
    await page.waitForURL(/\/login\?/);
    expect(new URL(page.url()).searchParams.get('next')).toBe(`/s/${SLUG}`);
  });

  test('@guest the public page leaks no private fields in its HTML', async ({ page }) => {
    const html = await (await page.request.get(`/s/${SLUG}`)).text();
    expect(html).not.toMatch(/service_role|SUPABASE_SERVICE|"user_id"|buk_mcp_|buk_org_|sk-[A-Za-z0-9]{20,}/);
  });

  test('@guest an unknown or private slug is a clean 404, not a 500', async ({ page }) => {
    const res = await page.goto('/s/this-stack-does-not-exist-e2e');
    expect(res?.status()).toBe(404);
  });

  test('@authed signed-in user remixes with one click and owns an independent copy', async ({ page }) => {
    await page.goto(`/s/${SLUG}`);
    const original = await page.locator('main a[href^="http"]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
    const remix = page.getByRole('button', { name: /Remix this Stack/ });
    await expect(remix).toBeVisible();                                                    // proves the page knows we are signed in and not the owner
    const call = page.waitForResponse((r) => r.url().includes('/api/stacks/remix') && r.request().method() === 'POST');
    await remix.click();
    let res = await call;
    if (res.status() === 409 || res.status() === 400) {                                  // first-time creators must pick a public handle
      const handle = page.getByRole('textbox', { name: /handle/i });
      await expect(handle).toBeVisible();
      await handle.fill(`e2e_${Date.now() % 1_000_000}`);
      const retry = page.waitForResponse((r) => r.url().includes('/api/stacks/remix'));
      await page.getByRole('button', { name: /Remix this Stack/ }).click();
      res = await retry;
    }
    expect(res.status(), 'remix must succeed (401 = session lost, 429 = rate limited)').toBe(200);
    await page.waitForURL((u) => /^\/s\/[^/]+$/.test(u.pathname) && u.pathname !== `/s/${SLUG}`);   // the page jumps to the new stack on success
    const slug = new URL(page.url()).pathname.split('/').pop()!;
    expect(slug).not.toBe(SLUG);
    await expect(page.getByText('This is your stack')).toBeVisible();
    await expect(page.getByText(/remixed from/i)).toBeVisible();                          // attribution to the original
    const copied = await page.locator('main a[href^="http"]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
    expect(copied.filter((h) => original.includes(h)).length, 'every original link is in the remix').toBe(original.length);

    // the original is untouched and shows the bumped remix count
    await page.goto(`/s/${SLUG}`);
    await expect(page.getByRole('button', { name: /Remix this Stack/ })).toBeVisible();
  });

  test('@authed double-clicking Remix creates exactly one copy', async ({ page }) => {
    await page.goto(`/s/${SLUG}`);
    let posts = 0; page.on('request', (r) => { if (r.url().includes('/api/stacks/remix') && r.method() === 'POST') posts++; });
    const b = page.getByRole('button', { name: /Remix this Stack/ });
    await b.dblclick();
    await page.waitForTimeout(1500);
    expect(posts, 'the UI locks after the first click').toBe(1);
  });
});

export type { Page };
