# Bukmarkz i18n kit (en, es, de, ja, hi)

Location-aware routing for the Next.js App Router.

Locale priority: saved `NEXT_LOCALE` cookie > browser `Accept-Language` > country header (`x-vercel-ip-country` / `cf-ipcountry`) > `en`.
`IN` maps to `en` (edit `COUNTRY_TO_LOCALE` in `i18n.ts`). The URL locale always wins over the cookie.

## Install
1. Copy `i18n.ts`, `middleware.ts`, `components/`, `lib/`, `messages/` and `app/[locale]/` into the Next.js project root.
   `middleware.ts` replaces the Supabase-only one; `lib/supabase/middleware.ts` here is the locale-aware version of `dash/lib/supabase/middleware.ts`.
2. Move the existing pages under `app/[locale]/` (landing, `dashboard`, `login`). Keep `app/auth/callback/route.ts` OUTSIDE `[locale]` (the OAuth redirect URL must not change).
3. Prefix internal links with the locale (`/${locale}/dashboard`).
4. Have a native speaker review `messages/*.json` (placeholder strings).

## Tests (logic only; Next itself is stubbed)
`test/` holds node:test files and esbuild stubs. Bundle with `test/build_test.mjs` (adjust the esbuild path), then `node --test`.
Not yet run inside a real Next.js app: test `/`, `/dashboard?x=1` and the OAuth login locally first.
