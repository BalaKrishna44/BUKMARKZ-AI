# Instant Code Snippet Extractor

Right-click code in the browser (or paste a link in the dashboard) and Bukmarkz keeps it as a searchable, copy-ready snippet.

## Install
1. `sql/014_snippets.sql` (needs `oneclist_items`).
2. Copy `lib/snippets/`, `app/api/snippets/`, `components/snippets/`, `app/dashboard/snippets/`. Deps: `lucide-react`, `framer-motion`, `zod` (already used elsewhere). Uses `@/lib/server` (admin, json, requireUser), `@/lib/url`, `@/lib/ssrf` from knowledge-os.
3. Extension: copy `extension/snippets.ts` to `ext3/src/background/snippets.ts`, then three small edits in `background.ts`:
   - `createMenu()`: also create `Object.values(SNIPPET_MENU)` items.
   - `onMenuClick`: `if (info.menuItemId === SNIPPET_MENU.selection.id || info.menuItemId === SNIPPET_MENU.page.id) { const r = await saveSnippetsFromTab({ tab: tab ?? {}, mode: info.menuItemId === SNIPPET_MENU.page.id ? 'page' : 'selection', token: (await liveSession())?.accessToken ?? null, apiBase: API_BASE }); const m = snippetMessage(r); return notify(m.title, m.body); }`
   - Re-run `createMenu()` on install (already done by `onInstalled`). No new permissions: `scripting`, `activeTab`, `contextMenus` and the bukmarkz host are already in the manifest.
4. Link `/dashboard/snippets` from your dashboard nav.

## Rules
- Private to the owner (RLS). Writes only through `save_snippets()`: 20 per request, 300 per rolling day, 5,000 total; identical code is stored once per user.
- Server re-cleans every block, re-detects language and **refuses anything that looks like a real credential** (AWS/GitHub/OpenAI/Anthropic/Slack/Stripe keys, JWTs, private keys, hard-coded passwords). Doc placeholders such as `YOUR_API_KEY` pass.
- Page reads (`/api/snippets/extract`) are SSRF-safe, 2.5 MB / 8 s, and limited to 30 per user per hour.
- The extension never sends anything from incognito windows.

## Tests
`npx tsx test/extract.test.ts` (no database) and `test/run_sql.sh` (PostgreSQL 16 binaries).
