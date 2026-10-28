# Auth API for the Bukmarkz AI sign-in screens

Backend: Django REST + Knox (the code in `accounts/`). Frontend: `BukmarkzApp.tsx` with `apiBaseUrl`.

## Turn it on
1. `python manage.py migrate` (adds `MagicLink` and `CustomUser.email_verified`; existing users are marked verified).
2. `.env.prod`:

       MAIN_URL=https://app.bukmarkz.com            # the FRONTEND address: it goes into emailed links
       CORS_ALLOWED_ORIGINS=https://app.bukmarkz.com
       SENDGRID_API_KEY=...                         # magic links and resets are sent through mailings/
       EMAIL_ADDRESS=noreply@bukmarkz.com           # a sender verified in SendGrid
       # optional, only for the Google / GitHub buttons:
       OAUTH_ALLOWED_REDIRECTS=https://app.bukmarkz.com/auth/callback
       GOOGLE_OAUTH_CLIENT_ID=...   GOOGLE_OAUTH_CLIENT_SECRET=...
       GITHUB_OAUTH_CLIENT_ID=...   GITHUB_OAUTH_CLIENT_SECRET=...

3. Register `https://app.bukmarkz.com/auth/callback` as the redirect/callback URL in the Google and GitHub apps
   (exactly that string; the server refuses any other).
4. Cron (daily): `python manage.py purge_magic_links`.
5. Frontend:

       <BukmarkzApp
         apiBaseUrl="https://api.bukmarkz.com/api"
         oauth={{ google: { clientId: '...' }, github: { clientId: '...' } }}   // omit a provider to hide its button
       />

## Endpoints (all JSON)
| Request | Success | Failure |
|---|---|---|
| `POST /auth/login/` `{email, password}` (legacy `{username, password}` still works) | `200 {user, token, expiry, created:false}` | `400 {code:"invalid_credentials", detail}` (same answer for a wrong password, an unknown email and a magic-link-only account) |
| `POST /auth/register/` `{name, email, password}` | `201 {user, token, expiry, created:true}` | `400 {code:"email_taken"\|"validation_error", detail, fields:{name?,email?,password?}}` |
| `POST /auth/magic-link/` `{email, mode:"signin"\|"signup", name?}` | `200 {detail}` **always the same**, whether or not the account exists | `400` for a bad email, or a missing name in signup mode |
| `POST /auth/magic-link/verify/` `{token}` | `200 {user, token, expiry, created}` | `400 {code:"invalid_token"}` (unknown, used and expired look identical) |
| `POST /password_reset/` `{email}` | `200 {status:"OK"}` always | |
| `POST /password_reset/confirm/` `{token, password}` | `200 {status:"OK"}` | `404` bad/used token, `400 {password:[...]}` weak password |
| `POST /auth/oauth/<google\|github>/` `{code, redirect_uri}` | `200 {user, token, expiry, created}` | `400 {code:"oauth_failed"\|"email_unverified", detail}` |
| `GET /auth/user/` (Token) | `200 {id, email, name, ...}` | `401` |
| `POST /auth/logout/` (Token) | `204` | |

Every endpoint can also answer `429` with `Retry-After`. Authenticated calls send `Authorization: Token <token>`.
Public endpoints ignore any Authorization header, so a stale token can never break sign-in.

## How the emailed links work
- Magic link: `https://app.bukmarkz.com/?magic=<token>`. The page POSTs the token to `/auth/magic-link/verify/`
  (a POST, so mail scanners that pre-fetch links cannot use them up), then removes the token from the address bar.
  15 minutes, single use, only the newest link works. Only a SHA-256 hash is stored.
- Reset link: `https://app.bukmarkz.com/reset_password/confirm/<token>` (the URL your existing email already builds).

## Security decisions
- **No account enumeration** on sign-in, magic link and reset: the responses and the timing do not reveal whether an email exists.
  (Sign-up has to say "already registered"; it is rate limited.)
- **Pre-hijacking is closed.** Password sign-ups are not email-verified. If someone registered a victim's address in
  advance, the victim proving the mailbox (magic link, OAuth or password reset) clears that password and every session
  and marks the account verified. Consequence: a person who signed up with a password and never verified, then uses a
  magic link, will find their old password no longer works; "Forgot password" sets a new one.
- Magic links created from "Sign in" never create accounts; only "Create account" links do.
- OAuth: authorization-code flow, the secret stays on the server, `redirect_uri` must match the allow-list exactly,
  the browser checks a random `state`, and only provider-verified emails are accepted.
- Rate limits (settings): login 10/min, register 10/h, magic link 10/h per IP and 5/h per email, reset 10/h, OAuth 30/h.
  They use Django's cache: with several gunicorn workers use a shared cache (Redis) or the limits multiply.
- The token is kept in `localStorage`, so an XSS bug could read it. Ship a strict Content-Security-Policy; moving to an
  httpOnly cookie is the stronger option later.

## Tests
- `python -m unittest accounts.test_auth_core` (no Django needed): tokens, usernames, OAuth exchange, error shapes.
- `python manage.py test accounts` (needs the project environment): API tests for every endpoint above.
