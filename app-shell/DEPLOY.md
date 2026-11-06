# Hosting Bukmarkz: Contabo VPS (Germany) + Coolify + Supabase Cloud (EU)

Chosen layout: **Coolify runs the Next.js app and its scheduler; the database, auth and Edge Functions run on Supabase Cloud, region Frankfurt (eu-central-1).** Everything stays in the EU, which is what the Privacy Policy says. Self-hosting Supabase on the same VPS is possible later; this guide does not cover it.

**Status:** CI builds the app and the Docker image successfully (GitHub Actions). No real deploy has happened yet.

## 0. One-time local step
```bash
cd app-shell && npm install && npm run typecheck && npm run build   # fix any version range that fails
git add package-lock.json                                          # the Dockerfile then uses reproducible `npm ci`
```

## 1. Supabase (Frankfurt)
1. New project, region **Central EU (Frankfurt)**. Save the DB password in a password manager.
2. Enable extensions first (Database → Extensions): `vector`, `pg_cron`, `pg_net`. Create the Vault secrets (step 4 below) before the cron migrations.
   Then from the repo root: `supabase link --project-ref <ref>` and `supabase db push`. Order and exclusions: `supabase/MIGRATIONS.md`.
4. Vault secrets (SQL): `select vault.create_secret('https://<ref>.supabase.co','project_url'); select vault.create_secret('<CRON_SECRET>','digest_cron_secret');`
5. Auth → URL configuration: Site URL `https://bukmarkz.com`, add redirect URLs for `/auth/callback`. Turn on email confirmation.
6. Edge Functions: `supabase functions deploy check-link-health send-friday-digest weekly-digest --no-verify-jwt` and `supabase secrets set CRON_SECRET=... RESEND_API_KEY=... ANTHROPIC_API_KEY=... SITE_URL=https://bukmarkz.com`.
7. Project settings → Backups: turn on daily backups (paid plan) or schedule `pg_dump` to storage you control. **No backup = the Terms disclaim data loss, but your users will still leave.**

## 2. VPS (Contabo)
- Ubuntu LTS, 4 vCPU / 8 GB is comfortable (OCR with tesseract.js and page fetching are the heavy parts). Create a non-root sudo user, SSH keys only, disable password login.
- Firewall: allow only 22 (restrict to your IP if you can), 80, 443, and Coolify's panel port (8000) **from your IP only**. Everything else closed.
- Install Coolify with its official install script, then put its panel behind a domain with HTTPS or reach it over SSH tunnel.
- Turn on automatic security updates (`unattended-upgrades`).

## 3. Coolify
1. Connect the Git repo. New Resource → **Docker Compose** → base directory `app-shell`, file `docker-compose.yml`.
2. Domain for the `app` service: `https://bukmarkz.com` (Coolify issues the Let's Encrypt certificate). Add `www` as a redirect.
3. Environment tab: copy every variable from `.env.example`. Required to boot: `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` (16+ random chars), `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`. Mark the `NEXT_PUBLIC_*` ones as **Build Variables**.
4. The service-role key and every API key stay server-side only. Never prefix them with `NEXT_PUBLIC_`.
5. Deploy. The healthcheck is `/api/health`. Start with `CSP_MODE` unset (report-only), watch `/api/csp-report`, then set `CSP_MODE=enforce`.
6. The `cron` service replaces `vercel.json` (which only works on Vercel). It calls the 8 `/api/cron/*` routes over the internal Docker network with the Bearer secret. Check its logs after the first 5 minutes.

## 4. DNS and email
- `A` record `bukmarkz.com` and `www` → VPS IP. Resend: verify the sending domain (SPF, DKIM, DMARC) before turning on digests.
- Chrome extension: point its API base to `https://bukmarkz.com` and publish it separately.

## 5. Go-live checklist
- [ ] `https://bukmarkz.com/api/health` returns `ok`; sign-up, login, save, search, export work end to end
- [ ] Cron logs show 200s; `check-link-health` runs every 10 minutes in Supabase
- [ ] Privacy Policy and Terms placeholders filled in; **Delete account** works (Settings → Account; test it with a throw-away user)
- [ ] Privacy Policy matches reality: hosting is Contabo (Germany) + Supabase (Frankfurt) + the AI providers
- [ ] Backups restore-tested once
- [ ] Spend caps set at OpenAI and Anthropic; `assertBudget` limits configured

## Known gaps
No Docker build or deploy has been run. `package-lock.json` does not exist yet. Payments and `/api/ask` are still open. A single VPS is a single point of failure: expect downtime during deploys and reboots.
