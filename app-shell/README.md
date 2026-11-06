# Bukmarkz app shell

One Next.js 15 tree assembled from the feature kits by `scripts/merge-kits.mjs` (kits stay the source of truth; `npm run merge` re-copies them, later kits win, see `ORDER`).
`package.json`, `tsconfig.json`, `next.config.ts`, `vercel.json`, `.env.example` are hand-maintained and never overwritten.

## Status — read before trusting it
- **`next build` has NOT been run** (the authoring sandbox had no npm network). What was checked statically: every `@/…` and relative import resolves inside the tree, and no two pages/route handlers map to the same URL.
- Dependency **version ranges are unverified**. First steps: `npm install && npm run typecheck`, then fix whatever it reports.
- Each kit's own tests passed in isolation; nothing has been run against the merged tree.

## Decisions made in the merge
| Conflict | Resolution |
|---|---|
| `/` : homepage kit vs frontend-kit landing | homepage wins; the other is at `/landing-v2` |
| `/dashboard` : dash (real data) vs frontend-kit demo | dash wins; demo at `/dashboard-demo` |
| `middleware.ts`, `lib/supabase/*` : dash vs i18n-kit | dash wins (session refresh + nonce CSP). **i18n locale redirect is NOT active.** |
| `[locale]` beside `[username]` (Next rejects two dynamic names at one level) | i18n pages parked in `app/_i18n-pending/` (not routed). Decide: `/[locale]/…` prefix with reserved usernames, or no locale in the URL. |
| `lib/mcp/*`, `api/mcp/tokens` | plan-gating's patch over knowledge-os (intended) |
| `app/manifest.ts` : pwa-kit vs mobile-pwa | mobile-pwa wins (starts at `/m`) |
| `next.config.ts` | merged from dash; `qa-suite/security/next.config.example.ts` not applied |

## Known gaps
- Crons in `vercel.json` other than knowledge-os's four are my choice of schedule. `send-friday-digest` runs from Supabase pg_cron, not Vercel.
- `framer-motion` / `lucide-react` / `zod` etc. versions are guesses (see above).
- SQL migrations (001–029) live in the kits' `sql/` folders and are not applied anywhere.
- Extension, Django `back_auth`, photo-backup and Edge Functions are intentionally not part of this tree.
