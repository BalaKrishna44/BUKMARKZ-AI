"""OAuth authorization-code exchange for Google and GitHub, with the HTTP client injected (testable offline).

    python -m unittest accounts.test_auth_core
"""
from dataclasses import dataclass

GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token'
GITHUB_USER_URL = 'https://api.github.com/user'
GITHUB_EMAILS_URL = 'https://api.github.com/user/emails'
GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'


class OAuthError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code        # 'oauth_failed' | 'email_unverified'
        self.message = message


@dataclass
class OAuthProfile:
    provider: str
    subject: str
    email: str
    name: str


def redirect_allowed(uri, allowed):
    """Exact match only: an open redirect_uri would let someone else's site receive a user's code."""
    return bool(uri) and uri in set(allowed)


def _json(response):
    try:
        return response.json()
    except Exception:
        raise OAuthError('oauth_failed', 'The sign-in provider sent an unexpected response.')


def _check(response):
    if getattr(response, 'status_code', 200) >= 400:
        raise OAuthError('oauth_failed', 'The sign-in provider rejected the request.')


def fetch_profile(provider, code, redirect_uri, *, client_id, client_secret, http, timeout=10):
    if not client_id or not client_secret:
        raise OAuthError('oauth_failed', 'This sign-in method is not configured.')
    try:
        if provider == 'github':
            return _github(code, redirect_uri, client_id, client_secret, http, timeout)
        if provider == 'google':
            return _google(code, redirect_uri, client_id, client_secret, http, timeout)
    except OAuthError:
        raise
    except Exception:  # network errors, timeouts, malformed bodies
        raise OAuthError('oauth_failed', 'Could not reach the sign-in provider.')
    raise OAuthError('oauth_failed', 'Unknown sign-in provider.')


def _github(code, redirect_uri, client_id, client_secret, http, timeout):
    token_res = http.post(
        GITHUB_TOKEN_URL,
        data={'client_id': client_id, 'client_secret': client_secret, 'code': code, 'redirect_uri': redirect_uri},
        headers={'Accept': 'application/json'}, timeout=timeout)
    _check(token_res)
    body = _json(token_res)
    access = body.get('access_token')
    if not access:
        raise OAuthError('oauth_failed', 'GitHub did not accept the sign-in. Try again.')
    headers = {'Authorization': 'Bearer %s' % access, 'Accept': 'application/vnd.github+json'}
    user_res = http.get(GITHUB_USER_URL, headers=headers, timeout=timeout)
    _check(user_res)
    user = _json(user_res)
    emails_res = http.get(GITHUB_EMAILS_URL, headers=headers, timeout=timeout)
    _check(emails_res)
    emails = _json(emails_res)
    verified = [e for e in emails if isinstance(e, dict) and e.get('verified') and e.get('email')]
    primary = [e for e in verified if e.get('primary')]
    chosen = (primary or verified or [None])[0]
    if not chosen:
        raise OAuthError('email_unverified', 'Your GitHub account has no verified email address.')
    return OAuthProfile('github', str(user.get('id', '')), chosen['email'], user.get('name') or user.get('login') or '')


def _google(code, redirect_uri, client_id, client_secret, http, timeout):
    token_res = http.post(
        GOOGLE_TOKEN_URL,
        data={'code': code, 'client_id': client_id, 'client_secret': client_secret, 'redirect_uri': redirect_uri, 'grant_type': 'authorization_code'},
        timeout=timeout)
    _check(token_res)
    access = _json(token_res).get('access_token')
    if not access:
        raise OAuthError('oauth_failed', 'Google did not accept the sign-in. Try again.')
    info_res = http.get(GOOGLE_USERINFO_URL, headers={'Authorization': 'Bearer %s' % access}, timeout=timeout)
    _check(info_res)
    info = _json(info_res)
    if not info.get('email') or not info.get('email_verified'):
        raise OAuthError('email_unverified', 'Your Google account has no verified email address.')
    return OAuthProfile('google', str(info.get('sub', '')), info['email'], info.get('name') or '')
