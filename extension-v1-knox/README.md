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
    src/background/service-worker.ts session, saving, queue, badge, menu, shortcut, reminders
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
