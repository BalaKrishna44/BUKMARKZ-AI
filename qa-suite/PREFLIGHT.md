# Bukmarkz.com production pre-flight (10 points)

Run top to bottom on the **production build against staging data**, then once more against production after deploy. Items marked 🤖 have a script here; the rest are judgement calls.

```bash
node scripts/preflight.mjs https://bukmarkz.com --sender-domain=bukmarkz.com --build-dir=.next --env-file=.env.production --cron-paths=/api/cron/prices,/api/cron/resurface
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/preflight.sql        # read-only audit
supabase test db                                                         # runs supabase/tests/rls.test.sql (needs pgtap)
npx playwright test && npx tsx --test tests/mcp-api.test.ts
```

## 1. 🤖 Security headers: CSP, HSTS and friends
The code I was given contains **no header configuration at all** (no CSP, HSTS, `poweredByHeader:false`). Until `security/` is applied this item fails.
* Copy `security/csp.ts`; merge `security/next.config.example.ts` into `next.config.ts`; copy `security/middleware.example.ts` to `middleware.ts`. CSP is nonce-based with `strict-dynamic`; no `unsafe-eval` in production, no inline scripts.
* Allow-list is deliberately small: Supabase (https + wss), Stripe (`js.stripe.com`, `hooks.stripe.com`, `api.stripe.com`, `checkout.stripe.com` form-action), YouTube-nocookie frames (Shorts), `https:` images (favicons come from any site).
* Roll out in **Report-Only first** for 48 h (`Content-Security-Policy-Report-Only`), read the violations, then enforce. Check Stripe Checkout, Google/GitHub OAuth popups, Shorts embeds and the push-subscription flow.
* HSTS: 2 years + `includeSubDomains`. Add `preload` and submit to hstspreload.org **only** when every subdomain serves HTTPS (including `api.`/`mail.` hosts you may have forgotten).
* Pass: `preflight.mjs` §2 all green; `securityheaders.com` grade A.

## 2. 🤖 `NEXT_PUBLIC_` secret leakage
Anything prefixed `NEXT_PUBLIC_` is compiled into JavaScript every visitor downloads.
* Today's code uses only `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`: all public by design. Keep it that way.
* Must **never** be public: `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `CRON_SECRET`, `ALERT_SIGNING_SECRET`, `VAPID_PRIVATE_KEY`, `AFFILIATE_TAGS` (server only).
* `preflight.mjs` §4 decodes every JWT in the downloaded chunks (only `role: anon` may appear), greps for Stripe/OpenAI/Anthropic/Resend/AWS/Bukmarkz-token shapes, checks env names and probes for public `.map` files.
* Also: `git log -p --all | grep -E "service_role|sk_live|whsec_|buk_mcp_"` must be empty; rotate anything that ever appeared. Import server-only modules with `import 'server-only'` so a client import fails the build.

## 3. 🤖 SSL / TLS
* Certificate valid > 14 days, full chain, correct hostname (apex **and** `www`); TLS 1.2+ only; `http://` → `https://` with a 301/308; auto-renew confirmed (Vercel/host dashboard, not "I think it renews").
* Pass: `preflight.mjs` §1. Not verifiable from my sandbox (no outbound DNS): run it from your machine.

## 4. 🤖 DNS and email authentication (Resend)
* `A/AAAA/CNAME` for apex and `www`; `CAA` limiting issuers (warn if absent).
* Sender domain (`ALERTS_FROM`): SPF ending `-all` or `~all`, Resend DKIM at `resend._domainkey`, DMARC `p=quarantine|reject` with `rua=` reports. Gmail/Yahoo reject or spam-folder unauthenticated bulk mail: price-drop alerts are your bulk mail.
* Send one real alert to a Gmail and an Outlook inbox; check "Show original" for `spf=pass dkim=pass dmarc=pass`; confirm the one-click unsubscribe works and the `List-Unsubscribe` header is present.

## 5. 🤖 Webhooks, cron and machine endpoints
* `/api/webhooks/stripe`: verifies the signature on the **raw** body (`req.text()`, never parsed JSON), rejects forged/absent signatures with 400, is **idempotent on `event.id`** (Stripe retries and delivers out of order), and updates `user_subscriptions` (the table plan gating reads; the old `user_plans` is now a view). Send a real test event and a replayed one from the Stripe CLI (`stripe trigger customer.subscription.updated`).
* `/api/cron/*`: 401/403 without `CRON_SECRET`, with a wrong one, and with no header; accepts it only via `Authorization: Bearer`. Confirm the schedule in `vercel.json`/host and that a double-fire is harmless (price alerts claim atomically).
* `/api/mcp` and `/api/mcp/org`: 401 with no token; per-token burst limit returns 429 + `Retry-After`; monthly quota returns the upgrade result (see `tests/mcp-api.test.ts`).
* Pass: `preflight.mjs` §3 plus the Stripe CLI runs.

## 6. 🤖 Database access control (RLS)
* `supabase test db` → all 64 assertions pass, **after applying `fixes/019_stack_excludes_private_items.sql`** (3.7 fails without it: a link marked private could be published into a public stack).
* `supabase/preflight.sql`: RLS on every public table (FAIL otherwise), every `SECURITY DEFINER` function pins `search_path`, no view bypasses RLS (`security_invoker`), no invalid indexes. Review the "anon can execute" list; it should contain only `get_public_stack` and `stack_viewer_state`.
* Supabase dashboard: Auth → email confirmation on, leaked-password protection on, redirect URL allow-list contains only your domains, and Realtime/Storage policies reviewed (no public bucket holding private files).
* The service-role key lives only in server env; never in the extension or the browser.

## 7. 🤖 Vector index memory: HNSW / ivfflat
Your indexes: `oneclist_items.embedding` (HNSW, `vector(1536)`, m=16, ef_construction=64) and `bookmark_chunks.embedding` (HNSW). Both use `vector_cosine_ops`.
* **Size estimate (HNSW):** ≈ `rows × (4·dim + 16·m + ~56)` bytes. At dim 1536, m 16 that is ≈ 6.4 KB per vector: 100 k rows ≈ 0.6 GB, 1 M rows ≈ 6 GB. Measure the real number with `supabase/preflight.sql` item 9; treat the formula as a planning estimate only.
* **The chunk table is the real risk.** `bookmark_chunks` holds many chunks per bookmark; ×10–30 rows means ×10–30 memory. Project it with `\set target_rows <chunks you expect>`.
* **Query speed needs the index in RAM** (shared_buffers + OS cache). If `index size > RAM available to Postgres`, p95 search latency jumps from ms to seconds. Compare against your compute tier in the dashboard before launch; upgrade the tier or shrink the index (`halfvec` halves it on pgvector ≥ 0.7; embed less per item; partial index `where not is_private`).
* **Builds:** set `maintenance_work_mem` ≥ index size for the session running `CREATE INDEX`/`REINDEX` (else it spills and can take hours), use `CREATE INDEX CONCURRENTLY` on a live table and check `indisvalid` afterwards (preflight item 7).
* **Filtered search:** per-user and per-workspace filters happen after the ANN scan; keep `hnsw.iterative_scan = relaxed_order` and `hnsw.ef_search ≥ 100` as the SQL functions already set, and load-test a **small user in a big table** (the worst case: few results survive the filter).
* ivfflat (if you ever switch): needs `lists ≈ rows/1000` (≤1 M rows) and a `REINDEX` after big data shifts; probes trade recall for speed. HNSW is the right default here.
* Pass: biggest index < ~50 % of available RAM, `EXPLAIN (ANALYZE, BUFFERS)` on `match_oneclist_items` shows an index scan and `shared hit` ≫ `read`.

## 8. Secrets and configuration
* Production env set (names only; see each kit README): `CRON_SECRET`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `MCP_SUMMARY_MODEL`, `NEXT_PUBLIC_SITE_URL`, `RESEND_API_KEY`, `ALERTS_FROM`, `ALERT_SIGNING_SECRET`, `VAPID_*`, `AFFILIATE_TAGS`, `AI_PRICE_OVERRIDES`, Stripe live keys (**not** test keys), `AI_GLOBAL_MONTHLY_CAP_USD`.
* Env scopes: production secrets are not exposed to Preview deployments that run untrusted PR code.
* `npm audit --omit=dev`, lockfile committed, `web-push` installed, no `*` dependency ranges in server code.
* Extension: ship the production build (`scripts/preflight` has no extension check; use `extension/TESTING.md` D2).

## 9. Abuse and cost controls
* Plan gating is live end-to-end: Free → 20 asks, 50 MCP calls, 300 indexed items; refused calls are **not** charged; a metering outage fails closed (503), never unlimited.
* AI circuit breaker budgets set (25 % of plan price) and the global kill switch `AI_GLOBAL_MONTHLY_CAP_USD` configured; an alert fires at the 80 % warn level.
* Rate limits on unauthenticated surfaces: login/OTP, `/api/ingest`, `/s/*` remix (20 stacks/day is enforced in SQL), signup. Turn on Supabase Auth rate limits and CAPTCHA/Turnstile for signup.
* Affiliate links: only `components/deals/BuyButton.tsx` rewrites URLs, only for Free users, with the disclosure text and `rel=sponsored`. Stored URLs are never changed.

## 10. Recovery, observability and legal
* **Backups:** Supabase PITR on; do one **restore drill** into a scratch project and run `supabase/tests/rls.test.sql` against it.
* **Migrations:** applied in this order on a production clone first: 009–013 → 014 → 015 → 016 (after 013) → 017 (after 001, 004, 010, 012) → 018 (after 001) → `fixes/019`. Each is idempotent; take a backup before 016 and 017 (they replace `user_plans` with a view and redefine policies).
* **Rollback plan** written down: previous deployment pinned, feature flags for Team Vaults and price alerts, how to revoke all MCP tokens in one statement.
* Error tracking and uptime monitoring on `/`, `/api/mcp` (expects 401), `/s/<known-slug>`; alert routes tested.
* Legal: privacy policy names Supabase, Stripe, Resend, OpenAI/Anthropic as processors; affiliate disclosure; cookie banner only if you add analytics; account-deletion path works (Team Vault succession logic runs).

### Sign-off
| # | Item | Owner | Date | Pass |
|---|---|---|---|---|
| 1–10 | as above | | | ☐ |
