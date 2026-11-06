# Bukmarkz extension: test plan (v0.3.1, Manifest V3)

Two layers: **automated** (real Chromium with the extension loaded; runs in CI) and **manual** (things Playwright cannot drive: Chrome's native menu, real service-worker eviction, store policies).
Everything below was checked against the code in `ext3/` (v0.3.1). Where your brief and the code differ, the code wins and the difference is listed first.

## 0. Where the brief and the code differ

| Brief said | What v0.3.1 actually does | What to test instead |
|---|---|---|
| Service worker **refreshes** the token | It **cannot**. The refresh token deliberately never leaves the website (Supabase rotates refresh tokens, so two holders would sign each other out). The worker detects expiry and asks an open bukmarkz.com tab (`bridge:refresh-request` → `REFRESH_REQUEST`); the site re-sends a fresh *access* token. | "Token renewal via the website" (A2 below). Test that **no token travels in the request** and that **saves made while expired are kept and sent afterwards**. |
| Offline sync via **`indexedDB`** | Queue lives in **`chrome.storage.local`** (`bukmarkz.queue`), flushed by a 5-minute `chrome.alarms` alarm (`bukmarkz:flush`) and at sign-in. | Queue persistence across worker restarts (B3) rather than IndexedDB inspection. |
| "Contextual web overlay" | The overlay is the **save widget** (Ctrl/Cmd+Shift+S): closed shadow DOM, injected on demand with `activeTab` + `scripting`. There is no "related bookmarks while you browse" overlay in this version. | C-section tests the save widget. If a contextual overlay ships later, add the stubs in C6. |
| Offline link sync "for all links" | **Private (incognito) saves are never queued or uploaded** by design. | B5: assert they stay local. |

## 1. Automated suite

**Run** (needs Node 20+, `playwright` with Chromium, `openssl`, and permission to bind port 443, because the test maps `*.bukmarkz.test` to 127.0.0.1 with a throw-away certificate):

```bash
cd ext3
npm ci
BUKMARKZ_TEST_HOOKS=1 BUKMARKZ_WEB=https://www.bukmarkz.test BUKMARKZ_EXTRA_HOSTS=https://site.test \
BUKMARKZ_SUPABASE_URL=https://sb.bukmarkz.test BUKMARKZ_SUPABASE_ANON_KEY=anon npm run build
node test/e2e.mjs                      # real Chromium + the built extension, 30 steps
npm test                               # unit tests: bridge security, validation, reminders, feed grouping, ingest
```

* **Do not** set `BUKMARKZ_API`: the app serves `/api/ingest` on the web origin, and the harness's fake server answers there. (The README's older example sets it and makes every step fail with `code: 'server'`.)
* `BUKMARKZ_TEST_HOOKS=1` exposes `globalThis.__bk` in the worker so the test can call the context-menu handler. **Never ship that build** (`scripts/preflight.mjs` and checklist item X3 catch it).
* **Known stale steps.** Two popup steps in `ext3/test/e2e.mjs` still target the v0.2 popup (recent-saves list, "Synced" badge, `#tag` chips) and fail on v0.3.1. Replace them with `extension/test/popup-step.v031.mjs` from this kit. With that replacement, **30 of 30 steps pass** on v0.3.1.

### What the automated steps cover (mapped to your three areas)

| Area | Automated step (name in `e2e.mjs`) | Guarantees |
|---|---|---|
| **A1. One-click context-menu capture** | `Save Page: saves the page; Authorization is the Bearer JWT and no cookie is sent` | Page saved with the Bearer token, no cookies (no CSRF surface). |
| | `Save Page on a link saves the LINK, not the page it sits on` | Right-click on a link saves the link target. |
| | `Save Selection as Rich Note: quoted Markdown with a source link` | Selection becomes a `>` quote plus a `[title](url)` source line; brackets and parentheses are escaped. |
| | `Save Image: sends the page and the image address` | Image save sends page + `imageUrl`; no OCR claim while `OCR_AVAILABLE=false`. |
| | `unsavable clicks send nothing: data: image, empty selection, chrome:// page` | Nothing is sent for non-http(s) pages, `data:` images or an empty selection. |
| | `from an incognito tab the save stays on this device` | Private saves never leave the device. |
| **A2. Token renewal via the website** | `an expired token does not lose a menu save: it is queued, badge shows 1` | Expiry never drops a save. |
| | `when the website pushes the refreshed token, the queued save goes out and the badge clears` | Renewal drains the queue. |
| | `a revoked token (server says 401) keeps the save queued instead of dropping it` | Server-side revocation is survivable. |
| | `an expired session makes the worker ask the open website tab to renew; the page gets a message with no token in it` | The renew request carries no secret; a second ask is throttled. |
| | `an incognito tab cannot replace a different account's session` / `...may refresh the SAME account...` | No cross-account session swap; incognito sign-out does not sign out the normal window. |
| | `a token the server rejects is refused and not stored`, `a valid token is verified with the server and stored` | Tokens are verified server-side before being stored; the reply never contains the token. |
| **B. Offline queue** | `when the API is down the save is queued and the badge shows 1` | Network failure queues, badge shows the count. |
| | `queued saves sync once the API is back` | Flush delivers exactly the queued items. |
| | `a private save never touches the network`, `private reminders keep the title out of notifications` | Privacy rules hold offline. |
| **C. Overlay** | `overlay opens, is isolated from the page, and gets focus` | Closed shadow DOM: page scripts cannot read or style it; the input has focus. |
| | `typing in the overlay does not trigger page key handlers` | Page shortcuts (e.g. `j`/`k` on a site) do not fire while typing. |
| | `note + tag + reminder + Ctrl+Enter saves to the API`, `a reminder alarm was scheduled...`, `overlay closes itself after saving` | Full save path from the widget. |
| **Security** | `a page on another site cannot talk to the extension`, `malformed or unsafe messages are rejected`, `signing out on the site signs the extension out too` | The bridge only answers bukmarkz.com; input is validated; logout propagates. |

**What this suite cannot prove** (hence section 2): Playwright cannot click Chrome's native context menu (the test calls the handler directly), cannot force Chrome to evict the service worker, and does not test the Chrome Web Store build, Edge/Firefox builds or OS-level shortcut conflicts.

## 2. Manual checklist (≈ 25 minutes per browser)

Use a **clean Chrome profile** with the production build loaded unpacked (`dist/`), signed in at bukmarkz.com. Tick each line; note the browser and OS.

### A. Context-menu capture
- [ ] A1 Right-click on a normal article → **Save Page to Bukmarkz** → toast/badge `✓` within 2 s; the item appears on bukmarkz.com after refresh.
- [ ] A2 Right-click **on a link** (not the page) → saves the *link's* URL, title is empty or the link text.
- [ ] A3 Select 2 sentences → **Save Selection as Rich Note** → item has the quote and a source link; selection with `[ ] ( ) *` characters renders correctly.
- [ ] A4 Right-click an image → **Save Image to Bukmarkz** → label does **not** say "OCR" (until `OCR_AVAILABLE` is true).
- [ ] A5 On `chrome://extensions`, the Web Store, `about:blank`, a PDF viewer tab and a `file://` page: the menu item saves nothing and gives a clear reason (or is inert).
- [ ] A6 Save the **same URL twice** → one item, no duplicate; add `?utm_source=x` → still one item.
- [ ] A7 Keyboard: Ctrl/Cmd+Shift+S opens the overlay. On Edge/Brave check for shortcut conflicts and that `chrome://extensions/shortcuts` can rebind it.

### B. Session, expiry and offline queue
- [ ] B1 **Sign-in propagates:** sign in on bukmarkz.com with the extension installed → badge `!` disappears without opening the popup. Sign out on the site → badge `!` returns.
- [ ] B2 **Expiry:** sign in, then in DevTools → Application → Extension storage, edit `bukmarkz.session.expiresAt` to a past time. Save a page → badge shows `1`, popup says "Reconnecting…". Keep a bukmarkz.com tab open → within ~10 s the badge clears and the item exists on the site. Close all bukmarkz.com tabs, repeat → the popup shows **Open Bukmarkz**; click it → the queue drains.
- [ ] B3 **Offline + worker restart:** DevTools (service worker) → Network → Offline. Save 3 pages → badge `3`. Open `chrome://serviceworker-internals` → **Stop** the worker. Re-enable network. Within 5 minutes (the `bukmarkz:flush` alarm) or on next sign-in event the badge reaches `0` and **all 3 appear exactly once** (no duplicates, no losses).
- [ ] B4 **Browser restart with a non-empty queue:** go offline, save 2 pages, quit Chrome completely, reopen online → queue flushes.
- [ ] B5 **Private window:** enable "Allow in Incognito". Save from an incognito tab → no network request to `/api/ingest` (DevTools → Network on the service worker), item not on the site, notification hides the title.
- [ ] B6 **Account switch:** sign in as user A, save; sign in as user B in another browser profile's site tab → extension in profile 1 is **not** silently re-bound; queue from A is not uploaded under B.
- [ ] B7 **Revoked/401:** invalidate the session server-side (sign out everywhere in Supabase) → saves stay queued (badge `1`), nothing is lost, nothing loops (check there is no request storm in the worker's Network tab: at most one retry per alarm).
- [ ] B8 **Large queue:** queue 50 saves offline → flush completes without a single failed request storm, order preserved, badge `0`.

### C. Overlay (save widget)
- [ ] C1 Opens on: a plain page, a long scrolled page, a page with a sticky header, an SPA (e.g. GitHub), a page inside an `<iframe>` focus, a `contenteditable` editor (Google Docs, Notion).
- [ ] C2 **Strict-CSP pages** (github.com, twitter/x.com, banking sites): the widget still renders (it is injected by the extension, not the page), and the page's CSP console errors do not mention Bukmarkz.
- [ ] C3 Typing `j k / ? s` and Space in the note field does **not** trigger the page's shortcuts (YouTube, GitHub, Gmail).
- [ ] C4 Focus: opens with the note field focused; **Tab** cycles inside; **Esc** closes and returns focus to the page; Ctrl/Cmd+Enter saves; clicking outside closes without saving.
- [ ] C5 Visual: dark and light pages, 125–200% zoom, RTL page (`dir=rtl`), a page with huge `z-index` modals, a 320 px wide window. The widget is readable, not clipped, and sits above page content.
- [ ] C6 *(add when built)* Contextual overlay: renders only on pages with a related saved item, never calls the network per keystroke, can be dismissed per-site and respects incognito.
- [ ] C7 Page cannot spy: in the page console run `document.querySelector('*').shadowRoot` on the overlay host → `null` (closed shadow root); page CSS `* { display:none !important }` does not hide the widget.

### D. Security and release gates (do before every store submission)
- [ ] D1 `manifest.json` permissions are exactly `storage, activeTab, scripting, contextMenus, alarms, notifications`; `host_permissions` are only your Supabase project and bukmarkz.com; **no** `<all_urls>`, `tabs`, `cookies`, `history`, `webRequest`.
- [ ] D2 No `*.test` hosts, no `YOUR_PROJECT`, no `__bk`/test hooks in the shipped zip: `unzip -p bukmarkz-chrome.zip manifest.json | grep -E "\.test|YOUR_PROJECT"` returns nothing, and `unzip -p bukmarkz-chrome.zip service-worker.js | grep -c "__bk"` prints `0`.
- [ ] D3 CSP is `script-src 'self'; object-src 'self'; base-uri 'none'; frame-ancestors 'none'` (no remote code, no `unsafe-eval`).
- [ ] D4 From a page on another origin, `window.postMessage({channel:'bukmarkz.bridge.v1',from:'page',type:'AUTH_LOGIN',...},'*')` is ignored (covered by automation; do once by hand on a real site).
- [ ] D5 Token hygiene: DevTools → service-worker console shows **no** `eyJ...` strings; `chrome.storage.local` holds only the access token (never a refresh token).
- [ ] D6 Version bump in `manifest.json` and `config.ts` (`EXTENSION_VERSION`); privacy disclosure matches reality: URL/title (+ note, tags, favicon, description) sent to Bukmarkz on a user action only; incognito saves stay local.
- [ ] D7 Store builds (`npm run build:edge`, `build:firefox`) load and pass B1 + A1. Firefox uses an `iife` worker; re-run B3 there (event pages differ).

## 3. When something fails

| Symptom | Likely cause |
|---|---|
| e2e: `code: 'server'` on every login step | A build was made with `BUKMARKZ_API` set; unset it. |
| e2e: `Cannot find package 'playwright'` | `npm i -D playwright && npx playwright install chromium` in `ext3/`. |
| e2e: bind `EACCES 443` | Run with a user that may bind 443, or `sudo setcap cap_net_bind_service=+ep $(which node)`. |
| Badge stuck on `1` | Worker is waiting for a fresh token: open a bukmarkz.com tab (A2/B2), or check the server returns 200 for `GET /api/ingest` with the token. |
| Overlay missing on one site | That page blocks injection (Chrome Web Store, `chrome://`, PDF viewer): expected, A5. |
