# Bukmarkz QA and security audit suite

Drop into the repo root (paths match: `e2e/`, `tests/`, `supabase/tests/`, `extension/`, `security/`, `scripts/`, `fixes/`). Start with `PREFLIGHT.md`.

| Pillar | File | Run |
|---|---|---|
| 1 E2E | `e2e/full-flow.spec.ts` (+ `playwright.config.ts`, `auth.setup.ts`, fixture) | `E2E_EMAIL=… E2E_PASSWORD=… E2E_STACK_SLUG=… npx playwright test` |
| 2 RLS | `supabase/tests/rls.test.sql` (pgTAP, 64 assertions) | `supabase test db` |
| 3 Extension | `extension/TESTING.md`, `extension/test/popup-step.v031.mjs` | see the file |
| 4 MCP/API | `tests/mcp-api.test.ts` (26 in-process + live HTTP mode) | `npx tsx --test tests/mcp-api.test.ts` |
| 5 Pre-flight | `PREFLIGHT.md`, `scripts/preflight.mjs`, `supabase/preflight.sql`, `security/*` | see the file |

## Environment for E2E
`E2E_BASE_URL` (default localhost:3000), `E2E_EMAIL`/`E2E_PASSWORD` (a dedicated **test** account on a staging Supabase), `E2E_STACK_SLUG` (a public stack owned by a *different* account) and optionally `E2E_STACK_TITLE`. `E2E_SEED=1` + `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` seeds/cleans the vault (staging only; it refuses URLs that look like production). Without seeding, set `E2E_VAULT_HAS_DATA=1` to run the Ask test against an existing vault.

## How this was verified (and what was not)
| Suite | Result here | Caveat |
|---|---|---|
| `rls.test.sql` | 64/64 on PostgreSQL 16 with the project's migrations 010, 012, 017 + `fixes/019`; 63/64 without the fix; 9 failures when I deliberately broke policies/grants (it catches regressions) | pgTAP isn't installable here, so a 40-line shim (`supabase/tests/_sandbox/pgtap_shim.sql`) ran it; the file itself is plain pgTAP. Stand-ins for `auth.*` and pgvector. Not run on a real Supabase project. |
| `mcp-api.test.ts` | 26/26 against the real `lib/mcp` + plan-gating code | Metering is an in-memory copy of the SQL contract; the live-HTTP half only runs when you set `MCP_URL`/tokens. |
| `full-flow.spec.ts` | 18/18 (desktop + Pixel 7) | **Ran against a stand-in app** that reproduces the DOM contract (`e2e/_selftest/mock-app.mjs`), not your Next.js app, Supabase or OpenAI. Expect to adjust a selector or two on first real run. |
| Extension e2e | 30/30 on v0.3.1 (real Chromium + built extension) | with the replacement popup step; the Chrome native menu is simulated by calling the handler. |
| `csp.test.ts` | 6/6 | Not tried in a running Next.js 15 app. |
| `preflight.mjs` | correct PASS/FAIL on a good and a bad local server | TLS and DNS branches could not run (sandbox has no outbound DNS). |
| `preflight.sql` | ran on the sandbox schema | pgvector checks reported missing there, as expected. |

## Where your brief and the code differ (tests follow the code)
1. **Guest redirect goes to `/login?next=/dashboard/import/resume&ref=switch_raindrop`**, not `/signup`. The spec accepts either path.
2. **MCP monthly quota is HTTP 200 with a tool error**, not 429. That's intentional so MCP clients show the upgrade link to the user; 429 + `Retry-After` is the per-minute burst limiter, 503 is a metering outage. **Free is also read-only** (`save_bookmark` → `pro_required`). Tests pin this. If you do want a 429 for quota, change `protocol.ts` and one test.
3. **No public items exist in `oneclist_items`.** Public sharing is stacks, read only through `get_public_stack()`; tests check that.
4. **Extension "v3.1" is `ext3/` (0.3.1).** The offline queue is `chrome.storage.local`, not IndexedDB; the service worker doesn't refresh tokens, the website does. There's no contextual overlay yet: the overlay is the save widget.
5. **Morning Resurface** shows older links to revisit; saving a new link doesn't add to it. The spec tests the interaction (progress bar/counter), and that the new link is saved and searchable.

## Real bug found
`create_stack()` ignored `is_private`; stacks are public by default, so a private link could be published to anonymous visitors. `fixes/019_stack_excludes_private_items.sql` fixes it; RLS test 3.7 covers it. I did not apply anything to your repo or database.
