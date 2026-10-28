# Bukmarkz pre-launch security audit

Scope: `back_auth/` (Django), the Next.js dashboard / enrichment / ingest code, the extension v3.2, Docker + nginx, secrets handling.
Method: read the code and config, ran what could be run here (settings under 14 environments, scanners on the build outputs). Secret VALUES were never printed; only lengths and key-type prefixes were inspected.

## Files in this bundle (paths are relative to `back_auth/`)
| File | Action |
|---|---|
| `bukmarkz/settings.py` | replace |
| `.dockerignore`, `.env.prod.example` | add |
| `nginx/nginx.conf`, `nginx/proxy_params.conf`, `nginx/Dockerfile` | replace / add |
| `subscription/views.py`, `subscription/withdraw_services.py`, `subscription/checkout_services.py`, `offers/views.py` | replace |
| `subscription/MODELS_PATCH_replace_Withdraw_class.txt` | replace the `Withdraw` class in `subscription/models.py` with it; add `'status'` to `WithdrawAdmin.list_display` |
| `subscription/migrations/0012_*.py`, `0013_*.py` | add (0012 depends on your `0011_auto_20210219_1453`) |
| `scripts/scan_bundle.py` | add; run on every client build |
| `tests/` | `python3 -m unittest discover -s tests -t .` (no Django needed; 22 tests) |

## Findings

| # | Severity | Finding | Evidence | Fix in this bundle |
|---|---|---|---|---|
| 1 | **Critical** | Card number, expiry **and CVC** stored in plaintext in the database | `subscription/models.py` `Withdraw` (card_number, expiry_date, cvc); `withdraw_services.create_user_withdraw` | Model + service + view changed to a payout e-mail; migrations 0012/0013 overwrite then drop the columns |
| 2 | **Critical** | `.env.prod` / `.env.prod.db` are copied into the Docker image | No `.dockerignore`; `Dockerfile.prod` runs `COPY . .` twice | `.dockerignore` |
| 3 | **High** | Production `SECRET_KEY` is 26 characters (Django expects >= 50 random) | `.env.prod` | Settings refuse to start with a short key; rotation steps below |
| 4 | **High** | Site served over plain HTTP on a bare IP; HTTPS settings only if `ENABLE_HTTPS=1` (not set); `MAIN_URL=http://159.65.127.14:1337` | `.env.prod`, `nginx.conf` listens on 80 only | TLS nginx config; HTTPS on by default in production |
| 5 | **High** | `ALLOWED_HOSTS` and CORS list the raw IP (and `http://`), not the domains | `.env.prod`, `settings.py` | Explicit hosts and exact HTTPS origins |
| 6 | **High** | Django admin reachable by anyone at `/api/admin/` | `bukmarkz/urls.py`, nginx | nginx IP allow-list (set your IP) |
| 7 | **Medium** | `STRIPE_SECRET_KEY` (29 chars) does not look like a real Stripe key (live keys are `sk_live_` + ~100 chars); `.env.prod` lacks `STRIPE_WEBHOOK_SECRET`, `GOOGLE_OAUTH_*`, `CORS_ALLOWED_ORIGINS`, `WEBAUTHN_*` | `.env.prod` key names/lengths | Settings warn on a non-live key and require a key in production |
| 8 | **Medium** | Stripe charge: bare `except:` hides errors; no idempotency key (double click = double charge); legacy `Charge` + token API (no SCA/3-D Secure) and no webhook | `subscription/checkout_services.py` | Narrow except, idempotency key, token check. Moving to Checkout/PaymentIntents + a verified webhook is still recommended |
| 9 | **Medium** | Public endpoints list data to anonymous callers | see table below | `AllOffers` now `IsAuthenticated` |
| 10 | **Medium** | Browsable API enabled (HTML forms advertise every endpoint) | DRF defaults | JSON renderer only |
| 11 | **Medium** | Postgres 12 (end of life) | `docker-compose.prod.yml` | Not changed here: plan an upgrade to a supported major |
| 12 | Low | `requirements.txt` ranges, not pinned; comment says never installed/tested | `requirements.txt` | Run `pip freeze` once it installs, commit pins, add `pip-audit` to CI |
| 13 | Low | Two server files that use the Supabase service-role key lack `import 'server-only'` | `knowledge-os/lib/server.ts`, `photo-backup/backend/lib/server.ts` (importexport's admin.ts has it) | Add the import; also add it to `lib/enrichmentService.ts` |
| 14 | Info | Supabase RLS not audited from here | n/a | Run the SQL at the end |

### Already good (verified in code)
- `DEBUG=0` in `.env.prod`; DRF default permission is `IsAuthenticated`; Knox token auth; per-endpoint throttles (login, register, OTP, reset, magic link, OAuth, passkey, contact, withdraw).
- Env files are in `.gitignore`. No hard-coded secrets in the Django code (pattern scan).
- Service-role keys are only read in server-side files; no `NEXT_PUBLIC_*` secret anywhere; no client component imports them.
- Bookmarks and categories are filtered by `request.user` (no cross-user reads); admin viewsets are `IsAdminUser`; admin serializer excludes password hashes.
- Containers run as a non-root user; Postgres is not published to the host; extension manifest is narrow (no `<all_urls>`, no `tabs`, CSP set).
- Build outputs scanned with `scripts/scan_bundle.py`: extension (Chrome, Edge, Firefox zips) and dashboard package are clean.

### `AllowAny` / no-auth endpoints
| Endpoint | Data | Verdict |
|---|---|---|
| accounts: register, login, OTP, magic link (request/verify), OAuth, password reset, passkey login | credentials flow | Must be public. All have a `throttle_scope`. Keep |
| `contact` form | writes a message | Public, `throttle_scope='contact'` (5/h). Keep |
| `SubscriptionReadOnlyViewSet` | plan names and prices | Public pricing page. Keep |
| `DefaultCategoryView`, `DefaultBookmarkView` (list/retrieve) | shared starter content, no user data. The write actions are `IsAuthenticated` | Keep |
| `VideoReadOnlyViewSet` | marketing videos | Keep |
| `AllOffers` | every country's partner offers | **Changed to `IsAuthenticated`** (confirm the logged-out site does not call it) |
Nothing that returns user data or admin data is open.

### CORS and the extension
- `settings.py` now allows exactly `https://bukmarkz.com` and `https://www.bukmarkz.com` (plus localhost outside production), no credentials, only on `/api/`.
- **The v3.x extension does not call this Django API**: it uses Next `/api/ingest` and Supabase. Requests from an extension's own service worker with host permissions bypass CORS, so no extension ID is needed. If a content script or popup ever calls Django, set `EXTENSION_IDS="<id>"` (validated: 32 letters a-p).
- To have a stable Chrome ID, publish through the Web Store (ID is assigned) or put a `key` in `manifest.json` for unpacked builds. Firefox uses a random per-install `moz-extension://` UUID that cannot be allow-listed.
- The old setting names (`CORS_ORIGIN_WHITELIST`) were renamed in django-cors-headers 3.5.0 and still worked as aliases then; I could not confirm they still work on 4.x, so the new names are used.

## Deploy steps (in this order)
1. **Rotate secrets first** (next section), because the old values may be in git history or an image.
2. Copy the bundle files over the repo; add `.env.prod.example`; fill real values on the SERVER only.
3. TLS: point DNS for `bukmarkz.com`, `www`, `api` at the host, obtain a certificate (certbot), mount it into the nginx container at `/etc/letsencrypt/...`, publish ports 80 and 443 in `docker-compose.prod.yml`, and edit the admin allow-list IP in `nginx.conf`.
4. `docker compose -f docker-compose.prod.yml build --no-cache` (the new `.dockerignore` applies), then `exec web python manage.py migrate` (runs 0012 then 0013) and `exec web python manage.py check --deploy` (should be silent).
5. Update the payout form in the frontend: it must send `{name, payout_email, amount}` and no card fields.
6. Delete old images/tags from any registry; verify: `docker run --rm --entrypoint sh <image> -c 'ls -a /home/app/web | grep -i env'` prints nothing.
7. Old database backups and the Postgres WAL may still contain card data: delete or age them out, and ask your payments/legal contact whether the exposure needs a notification (the data was in your own database, but you are the one who knows who had access).

## Key rotation runbook
Rule: **assume exposed, rotate, then clean history** (cleaning history does not un-expose a key that was already pushed or baked into an image).

| Secret | Where | Steps |
|---|---|---|
| Django `SECRET_KEY` | server `.env.prod` | `python -c "import secrets; print(secrets.token_urlsafe(64))"`. Put the old key in `SECRET_KEY_FALLBACKS`, deploy, wait a few days, remove it. Sessions and signed tokens made with the old key stay valid only during that window. Knox tokens are stored in the database, so they are not affected |
| Stripe secret key | Stripe Dashboard > Developers > API keys | Roll the key and give the old one an expiry (up to 7 days), update the server, deploy, confirm a test purchase, let the old key expire. Roll the webhook signing secret separately. Check Developers > Logs for calls you do not recognise. Use a restricted key (`rk_live_`) with only Charges/Customers write access if you can |
| Google OAuth client secret | Google Cloud Console > APIs & Services > Credentials > your OAuth client | Add a second secret, deploy it, then disable and delete the old one. Also confirm the authorised redirect URIs list only your own domains |
| GitHub OAuth secret | GitHub > Settings > Developer settings > OAuth Apps | Generate a new client secret, deploy, delete the old one |
| SendGrid / email | SendGrid > Settings > API Keys | Create a new key (restricted to Mail Send), deploy, delete the old one |
| OpenAI / Anthropic keys | provider consoles | Create a new key, deploy, revoke the old one. Set a monthly spend limit |
| Supabase **service role** | Dashboard > Project Settings > API (or API Keys) | Check the current dashboard wording. With the legacy JWT keys, rotating the JWT secret regenerates BOTH anon and service-role keys and signs everyone out (update the extension build and the site env at the same time). With the newer secret API keys, create a new secret key, deploy, delete the old one. The anon key is public by design; RLS is what protects data |
| Postgres password | database | `ALTER USER bukmarkz_app WITH PASSWORD '...';` then update the env. **Changing `POSTGRES_PASSWORD` in `.env.prod.db` does nothing on an existing volume**: it is only read when the data directory is first created |
| CRON_SECRET, ENRICH_WEBHOOK_SECRET | Vercel + Supabase webhook header | New random value in both places, redeploy |

### Git history
```bash
# 1. is anything sensitive in history? (install gitleaks or trufflehog)
gitleaks detect --source . --log-opts="--all" --redact
git log --all --diff-filter=A --name-only --format= | grep -Ei '(^|/)\.env' | sort -u     # env files ever added
# 2. after rotating: remove them from every commit
pip install git-filter-repo
git filter-repo --invert-paths --path .env.prod --path .env.prod.db --path .env --force
git push --force --all && git push --force --tags         # everyone re-clones; also purge forks and cached CI checkouts
# 3. keep it from happening again: GitHub > Settings > Code security > enable Secret scanning + Push protection
```
This working copy is not a git repository, so I could not check history; run step 1 on the real repo.

## Environment secrets: Vercel (Next.js)
1. Project > Settings > Environment Variables. Add each server secret for **Production** only (`SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `ENRICH_WEBHOOK_SECRET`, `CRON_SECRET`) and mark them **Sensitive** (write-only after saving).
2. Anything that must reach the browser starts with `NEXT_PUBLIC_` and is safe to publish: Supabase URL, anon key, Stripe **publishable** key. A secret must never have that prefix (it is inlined into the JS bundle).
3. Preview and Development get separate TEST values (Stripe test key, a staging Supabase project), never production ones: preview URLs are reachable by anyone with the link.
4. CLI: `vercel env add SUPABASE_SERVICE_ROLE_KEY production`. `vercel env pull .env.local` writes a git-ignored local file; never commit it.
5. Changes apply to NEW deployments only: redeploy after rotating.
6. Before each release: `npm run build && python3 scripts/scan_bundle.py .next/static` (fails the build if a secret shape is in the client output).
7. Server-only modules start with `import 'server-only'` so an accidental client import fails the build.

## Environment secrets: the Django host and CI
- **Server**: keep the real env file outside the repo and image, e.g. `/etc/bukmarkz/.env.prod`, owner root, mode 600; point compose at it with `env_file: /etc/bukmarkz/.env.prod`. For more than one host use Docker/Swarm secrets or a manager (Doppler, 1Password CLI, AWS/GCP Secret Manager).
- **GitHub Actions**: store values as *environment* secrets on a `production` environment with required reviewers; set `permissions: contents: read` at the top of workflows; pin third-party actions to a commit SHA; never use `pull_request_target` with secrets; never `echo` a secret. Prefer OIDC to the cloud over long-lived keys. Do not build the image with `--build-arg SECRET=...` (it is stored in image metadata).
- **CI gates** to add: `gitleaks` on every push, `python3 scripts/scan_bundle.py` on build output, `pip-audit -r requirements.txt`, `npm audit --omit=dev`, `python manage.py check --deploy --fail-level WARNING`.
- **Host**: firewall allows only 22 (restricted), 80, 443; SSH key-only; Postgres stays unpublished.

## Supabase RLS check (run in the SQL editor)
```sql
-- every table in public should have RLS on
select tablename from pg_tables where schemaname = 'public' and not rowsecurity;
-- policies that apply to everyone, including anonymous visitors
select tablename, policyname, cmd, roles, qual from pg_policies where schemaname = 'public' and (roles = '{public}' or roles @> '{anon}');
-- functions callable by anon / authenticated (security definer ones deserve a review)
select p.proname, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef;
```

## What I did not / could not verify
- Django itself is not installed in this environment, so `manage.py check --deploy`, the migrations and the Stripe/withdraw views were **not run**; they are syntax-checked, and the settings and the withdraw parsing are unit-tested with Django stubbed. Run the deploy steps in a staging copy first.
- Git history, Vercel project settings, CI workflows, the live server and the registry were not visible from here.
- I did not test any key against its provider.
