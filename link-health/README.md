# link-health: dead-link scanner + Wayback snapshots

Every 10 minutes `check-link-health` claims up to 60 due links, tests them, and for failing ones fetches the latest Wayback Machine snapshot. The database decides when a link is "dead".

| Piece | File |
|---|---|
| Edge Function (Deno) | `supabase/functions/check-link-health/index.ts` |
| Pure logic (Node-testable) | `supabase/functions/_shared/linkhealth.ts` |
| Schema + claim/apply/release RPCs | `link-health/sql/030_link_health.sql` |
| pg_cron schedule | `link-health/sql/030b_link_health_cron.sql` |

**Deploy:** run 030 then 030b (same Vault secrets as the digest crons) → `supabase secrets set CRON_SECRET=...` → `supabase functions deploy check-link-health --no-verify-jwt` (already in `config.toml`).

## Rules
- HEAD first; every non-OK answer is confirmed with a ranged GET (some servers mishandle HEAD).
- 2xx/3xx alive. 401/403/429/451/999 = site blocks bots → treated as alive. 404/410/NXDOMAIN = hard. Other 4xx, 5xx, timeouts = soft.
- `is_dead = true` after **2 consecutive failures incl. hard ones, or 3 of any kind**. A later success clears it (snapshot is kept). Schedule: healthy 14d, failing 1d, dead 7d.
- Wayback is queried only for failing links (max 30/run), never for `is_private` items. Only a 200 snapshot on `web.archive.org` is stored; a DB CHECK enforces the same pattern.
- Voice/scan/other non-http items are never touched.

## Security
SSRF: scheme/port/credential/hostname vetting, DNS resolved first and every address checked, redirects followed by hand with each hop re-vetted, no response bodies read. Auth: constant-time CRON_SECRET bearer. RPCs are service-role only. Logs hold counts only, never URLs.

## Tested / not tested
- Passed: 24 Node checks (`test/linkhealth.test.ts`: classification, SSRF, redirects, Wayback parsing) and 18 Postgres 16 checks (`test/run_sql.sh`: claim/skip-locked, thresholds, recovery, hostile archive URL, privileges, re-runnable).
- **Not run:** the Deno entrypoint itself (parse-checked only; no Deno here), real archive.org, a real Supabase project.
- Known residual: DNS rebinding between our lookup and fetch (Deno can't pin the resolved IP). Low impact since bodies are never returned. Saved-link URLs of dead links are sent to archive.org: disclose it in the privacy policy. Archive.org rate limits are unverified; the 30/run cap is conservative.
