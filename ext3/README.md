# Bukmarkz Chrome extension (Manifest V3, TypeScript)

Save any tab with Cmd/Ctrl+Shift+S, add a Markdown note, tags and a review reminder. Signing in at bukmarkz.com connects the extension automatically.

## Build and load
    npm install
    npm run build            # writes ./dist  (Tailwind CLI builds the popup CSS)
    npm run typecheck
    npm test                 # unit tests (bridge security, validation, reminder dates)

Chrome -> `chrome://extensions` -> Developer mode -> Load unpacked -> choose `dist/`.
Incognito: open the extension's Details and switch on "Allow in Incognito". Without that switch Chrome never runs the extension in private windows, whatever the manifest says.

## Set your domains
`src/shared/config.ts` and `host_permissions` / `content_scripts.matches` in `manifest.json` default to `www.bukmarkz.com`, `bukmarkz.com` and `api.bukmarkz.com`. Change them if your API lives elsewhere.

## Connect the website (3 lines)
Copy `web/extensionBridge.ts` into the React app, then:
    const r = await login(...);                 // any sign-in route
    void syncLoginToExtension(r.token, r.expiry);
    // on sign-out:
    void syncLogoutToExtension();

## Files
    manifest.json                    MV3, incognito "spanning", commands, CSP
    src/background/background.ts session, saving, queue, badge, menu, shortcut, reminders
    src/content/bridge.ts            page <-> extension relay (bukmarkz.com only)
    src/content/overlay.ts           in-page save widget (closed shadow DOM, injected on demand)
    src/popup/Popup.tsx              popup: current page, tags, note, reminder, recent saves
    src/shared/*                     config, types, messages, validation, storage, API, reminder presets
    web/extensionBridge.ts           client for the website
    test/unit.test.ts, test/e2e.mjs  unit tests; real-Chromium end-to-end test

## Behaviour worth knowing
- **Private = stays on this device.** Saves from incognito windows are never uploaded (the server has no private flag for them yet), and their reminder notifications hide the title. The browser tells the worker a tab is incognito; a page cannot fake it.
- **Offline.** If the API is unreachable the save is queued (badge shows the count) and retried every 5 minutes and at sign-in.
- **Server today** stores url and title only. The extension already sends `note` and `tags`; the server ignores them until it is extended. Reminders and recent saves live in the extension.
- **Badge:** `!` signed out, a number = saves waiting to sync, `✓` briefly after a synced save.

## End-to-end test
    BUKMARKZ_WEB=https://www.bukmarkz.test BUKMARKZ_API=https://api.bukmarkz.test BUKMARKZ_EXTRA_HOSTS=https://site.test npm run build
    node test/e2e.mjs        # needs playwright, openssl and port 443


## v0.2: Supabase sign-in, context menu, /api/ingest
- Website: `web/syncLoginToExtension.ts` → `useEffect(() => startExtensionSync(supabase), [])` once, in a client component that stays mounted.
- Server: `web/ingest.ts` + `web/app/api/ingest/route.ts` (copy to `lib/ingest.ts` and `app/api/ingest/route.ts`). Needs `oneclist_items` from importexport/sql/001.
- Only the ACCESS token is shared (about 1 h). While no bukmarkz.com tab is open past expiry, saves queue and upload when the site next refreshes the session.
- Right-click: Save Page / Save Selection as Rich Note / Save Image. OCR is NOT implemented: the image item is labelled honestly until `OCR_AVAILABLE` is set to true in `src/shared/config.ts`.
- Test build: `BUKMARKZ_TEST_HOOKS=1 BUKMARKZ_WEB=https://www.bukmarkz.test BUKMARKZ_EXTRA_HOSTS=https://site.test npm run build`, then `node test/e2e.mjs`. Never ship a test-hooks build.


## v0.3: categorised popup feed
- **Popup** (`src/popup/Popup.tsx`): signed-out view with "Sign in with Bukmarkz"; signed-in view with a prominent **Save current page** button (captures URL, title, favicon and meta description; "Note, tags…" expands the optional note/tags/reminder), a search box, category tabs (All + one per `ai_category`, with counts) and, under All, collapsible category groups.
- **`src/lib/auth.ts`**: reads the session the website bridge stored in `chrome.storage.local`; `getAuthState()` (signed-out / expired / signed-in), `onAuthChange()`, `openSignIn()`. Login path: web app → `bridge.ts` content script (bukmarkz.com only) → service worker verifies via `GET /api/ingest` → storage. Only the access token is shared.
- **`src/lib/api.ts`**: `fetchFeed(token)` = `GET {SUPABASE_URL}/rest/v1/extension_feed?select=id,title,url,favicon_url,ai_category,summary_tldr,created_at&order=created_at.desc&limit=500` with `apikey` + the user's JWT (RLS returns only their rows). Cached per user so the popup paints instantly, then refreshes.
- **`src/lib/feed.ts`**: pure grouping / filtering / row validation (unit tested).
- **Database**: run `sql/005_extension_feed.sql` (adds `favicon_url`, `meta_description` and the `extension_feed` view, `security_invoker`). Your schema stores the category on `categories.name` via `category_id`, the AI summary in `summary`; the view exposes them as `ai_category` and `summary_tldr`.
- **Server**: `web/ingest.ts` now accepts `favicon` (http/https only) and `description` (max 300) and stores them; copy over the updated `ingest.ts`.

### Configure and build
    BUKMARKZ_SUPABASE_URL=https://xxxx.supabase.co BUKMARKZ_SUPABASE_ANON_KEY=eyJ... npm run build
Or edit `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SIGN_IN_URL` in `src/shared/config.ts` and the Supabase host in `manifest.json`.

### Known limits
- Popup cannot sign out; sign out on the website (the bridge relays it).
- Favicons load straight from each site (lazy, no referrer); the view falls back to Google's favicon service for rows without one.
- Feed is capped at the newest 500 rows; there is no server-side search yet.
- Private-window saves stay local and are not shown in the feed.

## Other browsers

    npm run build:all      # dist (Chrome), dist-edge, dist-firefox
    npm run zip:all        # bukmarkz-chrome.zip, bukmarkz-edge.zip, bukmarkz-firefox.zip

- **Brave, Opera, Vivaldi, Arc:** install the Chrome build or your Chrome Web Store listing as is.
- **Edge:** same code as Chrome; submit `bukmarkz-edge.zip` to Microsoft Partner Center (Edge Add-ons).
- **Firefox:** the build switches the background to a script (not a service worker), adds
  `browser_specific_settings.gecko` (set `BUKMARKZ_GECKO_ID` to your own id), drops
  `minimum_chrome_version`, and simplifies the CSP. Check `data_collection_permissions` against
  addons.mozilla.org rules before submitting. Firefox treats `host_permissions` as optional, so
  the user may need to grant site access (Extensions > Permissions). AMO asks for your source code
  because the bundle is minified. Not yet tested in a real Firefox.
- **Safari:** not included. It needs Apple's converter in Xcode, a paid developer account, and
  the `notifications` API probably needs a fallback.


## v0.3.1: token refresh without sharing the refresh token
- The website still sends only the short-lived ACCESS token (Supabase rotates refresh tokens, so two holders would sign each other out).
- When the stored token is expiring or expired, the worker asks any open bukmarkz.com tab to renew it: alarm 2 min before expiry, on a queued save, on a 401 and at browser start (max one ask per 30 s, up to 3 tabs). The tab calls `supabase.auth.getSession()` (which refreshes if needed) and pushes the new token; queued saves then upload.
- No site tab open: nothing can renew it. Saves stay queued and the popup says "Open Bukmarkz".
- Message path: worker -> `bridge:refresh-request` -> bridge.ts (own extension only) -> `REFRESH_REQUEST` postMessage -> `startExtensionSync` (web/syncLoginToExtension.ts, now also copied to the website repo as lib/syncLoginToExtension.ts). No token travels in the request.
- Tests: `npm test` (38, includes the bridge and web sync paths); `test/e2e.mjs` in real Chromium. Two e2e steps ("popup lists the recent save…", "popup saves the current page…") still describe the v0.2 popup and fail; they need rewriting for the v0.3 feed popup.
