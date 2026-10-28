# Deploying the Django API to Heroku

Plan: **Basic dyno + Heroku Postgres Essential-1** (about $16 a month). Upgrade later with `heroku ps:type standard-1x`.

## 1. One-time setup (run on your own computer)
```bash
brew tap heroku/brew && brew install heroku      # or: npm i -g heroku
heroku login
cd back_auth
heroku create bukmarkz-api --region us            # pick any free name
heroku addons:create heroku-postgresql:essential-1
heroku stack:set heroku-24
```
`DATABASE_URL` is set for you by the add-on. Settings read it automatically.

## 2. Config vars (secrets live here, never in git)
```bash
heroku config:set \
  ENVIRONMENT=PRODUCTION \
  SECRET_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(64))')" \
  DJANGO_EXTRA_ALLOWED_HOSTS="bukmarkz-api.herokuapp.com" \
  MAIN_URL="https://www.bukmarkz.com" \
  STRIPE_SECRET_KEY="sk_live_..." STRIPE_PUBLIC_KEY="pk_live_..." STRIPE_WEBHOOK_SECRET="whsec_..." \
  SENDGRID_API_KEY="SG...." EMAIL_ADDRESS="you@bukmarkz.com" \
  GOOGLE_OAUTH_CLIENT_ID="..." GOOGLE_OAUTH_CLIENT_SECRET="..." \
  OPENAI_API_KEY="sk-..." \
  WEBAUTHN_RP_ID="bukmarkz.com" WEBAUTHN_ORIGINS="https://www.bukmarkz.com https://bukmarkz.com" \
  EXTENSION_IDS="<32-letter Chrome extension id>"
```
Use **new** keys (rotate the ones from the old `.env.prod`). Do not set `SQL_*` variables.

## 3. Deploy from GitHub
Heroku dashboard → your app → **Deploy** → GitHub → connect `BUKMARKZ-AI`.
The app lives in a sub-folder, so either:
- add the buildpack `https://github.com/timanovsky/subdir-heroku-buildpack` and set `PROJECT_PATH=back_auth`, **or**
- push only that folder: `git subtree push --prefix back_auth heroku main`.

Then click **Deploy Branch**. The `release` step runs `migrate` automatically.

## 4. Check
```bash
heroku logs --tail
heroku run python manage.py check --deploy
heroku run python manage.py createsuperuser
curl -I https://bukmarkz-api.herokuapp.com/api/
```

## 5. Custom domain (api.bukmarkz.com)
```bash
heroku domains:add api.bukmarkz.com      # then add the CNAME it prints at your DNS host (GoDaddy)
heroku certs:auto:enable                 # free managed TLS
```

## Things to know
- **Uploaded files vanish.** Heroku's disk is wiped on every restart. Anything written to `MEDIA_ROOT` must go to S3, Cloudflare R2 or Supabase Storage instead.
- **pgvector:** run `heroku pg:psql -c "CREATE EXTENSION IF NOT EXISTS vector;"` and confirm it succeeds on your plan before relying on AI search. If it fails, keep vectors in Supabase.
- **Backups:** `heroku pg:backups:schedule --at '02:00 Asia/Kolkata'`. Test one restore before launch.
- **Basic has no autoscaling or metrics.** Add Sentry and an uptime check.
- **Static files** are served by WhiteNoise; `collectstatic` runs during the build.
