# Passkeys for Bukmarkz: setup and test plan

## What is here
| File | Role |
| --- | --- |
| `accounts/passkey_core.py` | The rules (single-use challenges, 5-minute expiry, user binding, counter policy, one generic failure message). No Django, no library imports. |
| `accounts/test_passkey_core.py` | 27 unit tests for those rules. **Run and passing.** `python -m unittest accounts.test_passkey_core` |
| `accounts/passkey_webauthn.py` | The only file that imports the `webauthn` package (py_webauthn 2.x). **Never run** (package could not be installed where this was written). |
| `accounts/passkey_stores.py`, `models.py`, `migrations/0005_passkeys.py` | Database layer. Compiles; **never run** (Django not installed there). |
| `accounts/passkey_views.py`, `urls.py` | Six endpoints. Compiles; never run. |
| `accounts/tests_passkey_api.py` | API tests with a fake adapter. **Not run yet.** |

## Before it can run
1. **Upgrade the stack.** `webauthn` needs Python 3.9+ and a current `cryptography`. `requirements.txt` now targets Django 5.2 and a current `cryptography` (see DJANGO_UPGRADE.md). `pip install -r requirements.txt` installs `webauthn` with them.
2. `python manage.py migrate`
3. Environment variables:
   - `WEBAUTHN_RP_ID=bukmarkz.com` (the registrable domain; choose once, it cannot change without everyone re-registering)
   - `WEBAUTHN_ORIGINS=https://www.bukmarkz.com https://bukmarkz.com` (space separated, exact, https)
   - `WEBAUTHN_RP_NAME=Bukmarkz` (optional), `WEBAUTHN_USER_VERIFICATION=required|preferred` (default `required`)
4. Cron: `python manage.py purge_passkey_challenges` hourly.
5. Frontend: `npm i @simplewebauthn/browser`. The app imports it lazily, only when a passkey is used.

## Run the tests, in this order
1. `python -m unittest accounts.test_passkey_core accounts.test_auth_core`
2. `python manage.py test accounts.tests_passkey_api` (fake adapter; checks HTTP layer and database stores)
3. **A real browser.** Chrome DevTools > More tools > WebAuthn > "Enable virtual authenticator environment" > add one with "resident key" and "user verification" on. Register, sign out, sign in. Then repeat with a real 1Password, iCloud Keychain and Google Password Manager. Only this step proves the real library accepts real authenticator responses.

## Endpoints
`POST /api/auth/passkeys/register/options/` (signed in) / `register/verify/` {challenge_id, credential, label?}
`POST /api/auth/passkeys/login/options/` / `login/verify/` {challenge_id, credential} returns the same body as every other sign-in
`GET /api/auth/passkeys/`, `PATCH|DELETE /api/auth/passkeys/<id>/`
Errors use the existing shape `{code, detail}`; codes: `challenge_invalid`, `passkey_failed`, `limit_reached`, `already_registered`, `not_found`.

## Decisions worth knowing
- Sign-in uses discoverable credentials: no email is sent, so the endpoint cannot reveal who has an account.
- A signature counter of 0 is accepted (synced passkeys never count); a counter that goes backwards or repeats is refused.
- Passkeys are added while signed in; new accounts still start with email, magic link or OAuth. Lost every device: magic link, then add a new passkey.
- Sessions are still Knox tokens in the `Authorization` header, which CSRF cannot target. If you move the web app to `httpOnly` cookies, add CSRF protection at the same time (not done here).
- Registering a passkey does not ask the person to re-authenticate. Consider requiring a fresh sign-in before adding or removing one.
- Not built: Apple sign-in, cookie sessions, passkey-first sign-up, rate limits per account (only per IP/scope `passkey`: 30/minute).
