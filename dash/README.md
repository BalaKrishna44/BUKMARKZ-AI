# Live dashboard: Supabase auth, realtime and CRUD

Copy into the Next.js 15 app, keeping paths:

    middleware.ts                       session refresh + redirect of /dashboard to /login?next=...
    lib/supabase/{client,server,middleware}.ts
    lib/safeNext.ts                     only same-site `next` paths are honoured (no open redirect)
    lib/bookmarks.ts                    types, row mapping, tags, realtime reducer (pure, unit tested)
    lib/syncLoginToExtension.ts         pushes the session's access token to the extension (also answers its refresh requests)
    app/login/{page,LoginForm}.tsx      email + password, or an emailed sign-in link (never creates accounts)
    app/auth/callback/route.ts          link landing: exchanges the code for a session
    app/dashboard/{page,BookmarkFeedView,loading}.tsx
    sql/007_realtime_tasks.sql          completed_at + Realtime publication (run in the Supabase SQL editor)

Requires `npm i @supabase/ssr @supabase/supabase-js`, env NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY, migrations 001, 002, 004, 005 then 007.
In the Supabase dashboard: Authentication > URL Configuration: add `https://YOUR_DOMAIN/auth/callback` to Redirect URLs.

## What it does
- **Auth**: `middleware.ts` refreshes cookies on every request and redirects signed-out visitors of /dashboard to `/login?next=...`. `page.tsx` re-checks with `getUser()` (verified by Supabase, unlike `getSession()`). A 401 / expired JWT from any write, or a SIGNED_OUT in another tab, sends the page to /login. If you already have a middleware (e.g. the legacy-token exchange in migration/), call `updateSession(req)` first inside it and return its response.
- **Live data**: the server component loads the first 1,000 rows (links AND to-dos) and categories; the client then subscribes (`supabase.channel`) to `oneclist_items` and `categories` filtered to `user_id=eq.<you>`. INSERT/UPDATE/DELETE from the extension, the AI worker or another tab update the list in place. After a dropped connection it reloads everything on reconnect, so nothing is missed. A "Live / Reconnecting" dot sits in the header.
- **CRUD** (all optimistic, rolled back with a message on failure): delete (confirm dialog), move to folder, edit note, **edit tags** (removing an AI tag edits `ai_tags`; new tags go to `tags`), **to-do checkbox** (`completed_at`). Every write uses `.select('id')`, so a row-level-security refusal that changes 0 rows is reported as a failure instead of a silent success.
- **To-dos** are rows with `item_type = 'oneclist_task'` (set by migration 002 / the classifier). The "To-do" folder shows them; the count is the open ones.

## Tests (run in this repo's sandbox)
- `test/unit.test.ts` (6): tags, row validation, realtime reducer, `safeNext`.
- `test/e2e.mjs` (22): the real component in Chromium against a mocked Supabase client: realtime insert/update/delete/replay/garbage, reconnect reload, tasks, tags, delete, RLS-zero-rows, auth redirects, 390px. Build with `node build.mjs`, run `node e2e.mjs` (paths inside point at /tmp; adjust).
- `sql/007` was run twice on a local PostgreSQL 16 (idempotent, also when the publication is missing).

## Not verified (needs your project)
Real Supabase auth, Realtime and RLS; `next build`; middleware and the login and callback routes (they need `next` and `@supabase/ssr`, not installed here); the extension on a real Supabase JWT.

## Things to know
- **Realtime DELETE** events carry only the id and are not RLS-filtered (Supabase limitation); the dashboard ignores ids it isn't showing.
- **Schema**: this follows the import/export schema (001/002: `item_type`, `category_id`, `tags`, `ai_tags`). The ai-engine schema also defines a different table called `oneclist_items` (checklist steps with `done_at`); both cannot be the same live table.
- **Status values**: 001 only allows `status in ('bookmark','actionable_task')`. The enrichment worker writes 'pending' / 'processing' / 'processed' / 'failed', which that check rejects. Either relax it: `alter table oneclist_items drop constraint oneclist_items_status_chk;` or point the worker at `ai_status`.
- Passkeys / OAuth buttons are not on the login page; add them to `LoginForm` if you use them.
