# Django 3.1 -> 5.2 LTS upgrade

**Status: prepared, NOT installed or tested.** The environment that made these edits could not reach PyPI.

## What changed
- `requirements.txt`: Django 5.2, DRF 3.16, knox 5, cors-headers 4, countries 7, whitenoise 6, psycopg2-binary, current Pillow/requests/cryptography. Version ranges, not exact pins.
- Removed unused packages: `django-rest-auth`, `django-allauth`, `django-social-share`, `django-filter`, `bs4` shim and old transitive pins. Nothing in the code imported them.
- `settings.py`: removed `rest_auth` app and the unused `ACCOUNT_*` settings; removed `USE_L10N`; `STATICFILES_STORAGE` -> `STORAGES`; added `DEFAULT_AUTO_FIELD = AutoField` so existing tables need no migration.
- Dockerfiles: Python 3.12-slim. `Dockerfile.prod` no longer builds wheels with `--no-deps`.
- Test fix: `test_passkey_core` had an assertion that failed about 1 run in 8 by chance.

## Run it
    python3.12 -m venv .venv && . .venv/bin/activate
    pip install -r requirements.txt
    python manage.py check
    python manage.py makemigrations --check --dry-run   # expect: No changes detected
    python manage.py test

## Where it will most likely break
1. `django-rest-knox` 4 -> 5: token storage and settings changed. Check login, logout, and that existing tokens still work.
2. `django-rest-passwordreset` upgrade: run its migrations; re-test the reset flow.
3. `makemigrations --check` reporting changes: send me the output.
4. Python files named `import/` is a package called "import"; it works today, keep an eye on it.
5. Then `pip freeze > requirements.lock` and pin exact versions.
