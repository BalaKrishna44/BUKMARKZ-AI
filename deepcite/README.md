# Deep Cite

Select text on any page, save it as a highlight, and get a link that reopens the page scrolled to and highlighting that exact passage.
Then export a bibliography (BibTeX, APA 7, CSL-JSON) or a Markdown notes file with every quote and its deep link.

## Install
1. Run `sql/015_highlights.sql`. It needs `oneclist_items` (001) and, for the rate limit used by the API, `rate_hit` from `014_snippets.sql` (if 014 is missing the per-minute limit is skipped; the database caps below still apply).
2. Copy `lib/cite/`, `app/api/highlights/`, `app/api/cite/`, `components/cite/`, `app/dashboard/highlights/`. Dependencies already in the project: `zod`, `lucide-react`. Uses `@/lib/server` (admin, json, requireUser), `@/lib/url` (checkUrl) and `@/lib/supabase/server`.
3. Extension: copy `extension/highlights.ts` to `ext3/src/background/highlights.ts`, then in `background.ts`:
   - `createMenu()`: also create the `HIGHLIGHT_MENU` item.
   - `onMenuClick`: `if (info.menuItemId === HIGHLIGHT_MENU.id) { const r = await saveHighlightFromTab({ tab: tab ?? {}, token: (await liveSession())?.accessToken ?? null, apiBase: API_BASE }); const m = highlightNotice(r); return notify(m.title, m.body); }`
   - Only for the optional toolbar: `chrome.runtime.onMessage.addListener((msg, sender, send) => handleHighlightMessage(msg, sender, async () => (await liveSession())?.accessToken ?? null, API_BASE, send));`
   - No new permissions for the right-click path (`scripting`, `activeTab`, `contextMenus` are already there).
4. **Optional selection toolbar** (`extension/content-highlights.ts`): needs a `content_scripts` entry matching `http://*/*` and `https://*/*`. That is a broader permission than the rest of the extension asks for and will show in the store review and the install prompt. Ship the right-click path first and decide on the toolbar separately.
5. Link `/dashboard/highlights` from the dashboard nav.

## Rules
- Private to the owner (RLS). Writes only through `save_highlight()` / `set_cite_meta()`: 300 per rolling day, 5,000 total, 200 per page. The same passage on the same page is stored once.
- The quote is immutable (a different passage is a different highlight); only the note can be edited.
- Citation details come from the page's own tags (`citation_*`, JSON-LD, Dublin Core, OpenGraph), are cleaned on the server, and never overwrite details the user has corrected.
- The extension sends nothing from incognito windows, and takes the page URL from the browser's tab, not from the page.

## Limits you should know about
- **Text fragments are best-effort.** The browser scrolls to and highlights the text only if the page still contains it, and only in browsers that support them (Chromium and Safari; Firefox support is recent). If the page changed, or the text is rendered after load, the link still opens the page, just without the highlight. Selections that span paragraphs are saved as "first five words … last five words" so they still match.
- Dates and authors come from whatever the page publishes. Plenty of pages publish none, so the "Source details" editor matters.
- Semantic search over highlights (embeddings) is not included yet; search is keyword search with stemming.

## Tests
`npx tsx test/cite.test.ts` (60 checks, no database) and `test/run_sql.sh` (38 checks, PostgreSQL 16 binaries).
