# Bukmarkz growth kit

Five things that bring users in and keep them: a first-run checklist, more importers, search-friendly public Stacks, a weekly "links you forgot" email, and referrals. Plus the MCP directory copy and a Cursor guide.

## What is in it
| Area | Files | Notes |
|---|---|---|
| First run | `sql/020_onboarding.sql`, `lib/onboarding/checklist.ts`, `components/onboarding/FirstRunChecklist.tsx`, `scripts/seed_starter_stacks.sql` | 4-step checklist (add 5 links, ask, extension, remix a starter Stack). Starter stacks are normal public stacks flagged `is_starter` by you (users cannot set the flag). |
| Importers | `lib/importers/extra.ts` | Browser bookmark HTML (Chrome/Edge/Firefox/Safari), Reddit saved CSV, YouTube Watch Later CSV (Google Takeout), Readwise/Reader CSV. `detectAndParse(fileName, text)` picks the format. http(s) only, tracking params removed, duplicates dropped, 20,000-row cap, formula-injection guard. |
| SEO for Stacks | `lib/seo/stack-seo.ts`, `app/sitemap.ts`, `app/robots.ts`, `app/s/[slug]/opengraph-image.tsx`, `app/s/[slug]/page.example.tsx`, `sql/023_indexable_stacks.sql` | Stacks with fewer than 3 links are `noindex`. Canonical URL, share image, JSON-LD, `rel="ugc nofollow"` on user links. The sitemap RPC is service-role only. |
| Weekly digest | `sql/022_digest.sql`, `lib/digest/*`, `app/api/cron/digest/route.ts`, `app/api/digest/unsubscribe/route.ts` | **Opt-in** (off until the user turns it on). Atomic claim, so a double cron fire sends once. Skips users with fewer than 3 eligible links. Private links never included. Signed one-click unsubscribe (GET shows a button, POST unsubscribes). |
| Referrals | `sql/021_referrals.sql`, `app/api/referral/apply/route.ts`, `lib/referral-reward.ts`, `components/referral/ReferralCard.tsx` | +30 days Pro for both after the new user saves 5 links. Max 12 rewarded referrals per person; code must be applied within 7 days of signup; no self-referral. People on a paid plan are never modified: their days go to `referral_banked_days` for you to apply in Stripe. |
| MCP | `docs/mcp-listing-and-cursor-guide.md` | Listing copy, Cursor and Claude Desktop setup, troubleshooting, publish checklist. |

## Install order
1. Migrations (each re-runnable): `020_onboarding.sql` (after dash 010/012 and importexport 001), `021_referrals.sql` (after plan-gating 016), `022_digest.sql`, `023_indexable_stacks.sql`.
2. Seed starters: `psql "$DATABASE_URL" -v owner="'<uuid of your brand account>'" -f scripts/seed_starter_stacks.sql` (review every link first; the handle `bukmarkz` must be free).
3. Copy `lib/`, `app/`, `components/`. Adjust the imports that point at your own helpers: `@/lib/server` (admin, isCron, json: same as price-alerts), `@/lib/supabase/server|client`.
4. Env: `RESEND_API_KEY`, `DIGEST_FROM` (or `ALERTS_FROM`), `ALERT_SIGNING_SECRET` (16+ chars), `CRON_SECRET`, `NEXT_PUBLIC_SITE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server only).
5. Cron (`vercel.json`): `{ "path": "/api/cron/digest", "schedule": "0 4 * * 1" }`.
6. Wire-up: render `<FirstRunChecklist />` on the dashboard; call `onboarding_mark('extension')` when the extension first connects and `'ask'` after the first Ask; call `maybeRewardReferral(userId)` after each save; call `/api/referral/apply` once after signup when a `?ref=` value was stored; add a toggle that calls `set_digest_enabled(true|false)` in Settings (ask during onboarding, with a plain explanation); merge `page.example.tsx` into your Stack page; use `detectAndParse` in the import screen and map `ImportRow` to your item type.
7. Preflight: `023` and the service-role-only functions do not add anything to the "anon can execute" list. `onboarding_*`, `list_starter_stacks`, `get_or_create_referral_code` and `apply_referral` are for signed-in users only.

## Tested here (sandbox)
* `npm test` style runs: importers 10/10, onboarding 6/6, SEO 9/9, digest 7/7.
* `sh test/run_sql.sh` on PostgreSQL 16 with Supabase stand-ins: 31 checks (RLS/grants, idempotency, anti-abuse, paid plans untouched) plus the seed script run twice. `test/fixtures/plan_stub.sql` is a minimal copy of plan-gating 016, used only by the test.

## Not tested
Next.js rendering (`opengraph-image.tsx`, pages, components), Resend, Vercel Cron, real browsers, and real export files from Chrome/Reddit/Google/Readwise. **Export formats are from memory and may differ; try a real export of each before announcing the feature.** Components use Tailwind classes and your own Supabase helpers.

## Decisions for you
* **Digest default:** opt-in is the safe choice (consent rules differ by country). If you want opt-out, change the column default and tell existing users first.
* **Reward size:** 30 days / 12 referrals is a starting point. With a 6-month free trial already, a referral reward may mean little to new users; consider rewarding with extra AI asks or MCP calls instead.
* **Homepage numbers:** `homepage/lib/site-data.ts` still computes "Save 35%". If you keep the 50% offer, update `PRICE`/`SAVE_PERCENT` there too.

## Friday Vault After-Hours (029)
Opt-in Friday 16:00 (local time) email with a Markz and Buk skit. `sql/029_friday.sql` (+ `029b_friday_cron.sql`), `supabase/functions/send-friday-digest`, `supabase/functions/_shared/FridayJokeDigest.tsx` (re-exported at `emails/FridayJokeDigest.tsx`), `app/api/friday/unsubscribe`.
Copy `emails/assets/buk.png` and `markz.png` to `public/email/` (or set `FRIDAY_ASSET_BASE`). Opt-in from the app: `supabase.rpc('set_friday_enabled', { p_on: true, p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone })`.
Tests: `supabase/functions/_shared/friday.test.ts` (node:test) and `growth-kit/test/friday.test.sql` (run by `run_sql.sh`).
