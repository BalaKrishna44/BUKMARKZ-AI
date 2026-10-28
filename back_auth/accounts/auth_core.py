"""Pure helpers for the auth API (no Django imports, so they can be unit-tested anywhere).

    python -m unittest accounts.test_auth_core
"""
import hashlib
import re
import secrets

TOKEN_BYTES = 32  # 256 bits of randomness in every magic-link token


def new_magic_token():
    """Returns (token, token_hash). Only the hash is stored; the token goes in the email."""
    token = secrets.token_urlsafe(TOKEN_BYTES)
    return token, hash_token(token)


def hash_token(token):
    return hashlib.sha256(str(token).encode('utf-8')).hexdigest()


def normalize_email(email):
    return (email or '').strip().lower()


def magic_link_url(base_url, token):
    """The link in the email. A query parameter works on any host with an SPA fallback; no routing config needed."""
    return '%s/?magic=%s' % (base_url.rstrip('/'), token)


def is_expired(expires, now):
    return expires <= now


def split_name(name):
    parts = (name or '').strip().split()
    if not parts:
        return '', ''
    return parts[0][:150], ' '.join(parts[1:])[:150]


def base_username(email):
    local = normalize_email(email).split('@')[0]
    cleaned = re.sub(r'[^a-z0-9._-]', '', local)[:30]
    return cleaned or 'user'


def pick_username(email, exists):
    """A free username derived from the email's local part. `exists(candidate) -> bool` checks the database."""
    base = base_username(email)
    if not exists(base):
        return base
    for i in range(2, 100):
        candidate = '%s%d' % (base, i)
        if not exists(candidate):
            return candidate
    while True:  # extremely unlikely: fall back to random suffixes until one is free
        candidate = '%s-%s' % (base, secrets.token_hex(3))
        if not exists(candidate):
            return candidate


def first_messages(errors):
    """DRF error dict {"email": ["a", "b"]} -> {"email": "a"} (one message per field, non-field errors skipped)."""
    out = {}
    for key, value in (errors or {}).items():
        if key == 'non_field_errors':
            continue
        while isinstance(value, (list, tuple)) and value:
            value = value[0]
        if isinstance(value, dict):
            value = next(iter(first_messages(value).values()), '')
        if value:
            out[key] = str(value)
    return out


def error_body(code, detail, fields=None):
    """One error shape for every auth endpoint, so the frontend never guesses."""
    body = {'code': code, 'detail': detail}
    if fields:
        body['fields'] = fields
    return body
