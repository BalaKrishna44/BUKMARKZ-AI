# mobile-pwa: the phone app (installable web app)

| File | What |
|---|---|
| `app/m/layout.tsx` | Auth-gated shell: header, Save (+) button, bottom tabs, mounts `PWAProvider`, iOS home-screen metadata |
| `app/m/page.tsx` + `MobileLibrary.tsx` | Library: newest 500 saves, on-device search (`searchMatches`), tag chips |
| `app/m/save/*` | Save screen. The Android share sheet lands here pre-filled; **nothing saves until Save is tapped** |
| `app/api/save/route.ts` | `POST {url,title?,note?}`: http(s) only, canonical `url_key` dedupe, counts toward the indexed-links limit only for NEW rows (refund on failure), JSON-only + same-origin check for cookie sessions, `ai_status:'pending'` so enrichment runs |
| `app/m/stacks`, `app/m/you` | Stacks list; usage meters, push opt-in, sign out |
| `app/manifest.ts` | Overrides pwa-kit's: starts at `/m`, brand colours, shortcuts |
| `public/icons/*` | 192, 512, maskable-512 (logo inside the central 80%), apple-touch-icon (bookmark-with-eyes) |
| `test/save.test.ts` | 13 checks of the save route with the DB and plan gate stubbed (esbuild; see header) |

`pwa-kit`'s share-target now redirects to `/m/save` instead of the dashboard.

## Not done / assumptions
- **No Ask tab**: there is no `/api/ask` route yet (only `route.example.ts`). Add the tab when the route exists.
- `source: 'mobile'` is written to `oneclist_items.source`; I could not see that table's definition here, so confirm there is no CHECK constraint on `source` (the feed and MCP paths write `'rss'` / `'mcp'`).
- Not run: Next.js, a browser, an installed PWA, a phone. iPhone has no share-sheet target for web apps (use Add to Home Screen, then paste or the + button); Android share needs the app installed first.
- Friday-email toggle and Vault Studio are not on the phone yet.
