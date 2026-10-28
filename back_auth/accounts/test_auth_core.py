"""Unit tests for the pure auth helpers. No Django, database or network needed:
    python -m unittest accounts.test_auth_core
"""
import unittest
from datetime import datetime, timedelta

from accounts import auth_core as core
from accounts import oauth_core as oauth


class MagicTokens(unittest.TestCase):
    def test_tokens_are_unique_long_and_only_the_hash_matches(self):
        t1, h1 = core.new_magic_token()
        t2, h2 = core.new_magic_token()
        self.assertNotEqual(t1, t2)
        self.assertGreaterEqual(len(t1), 40)
        self.assertEqual(core.hash_token(t1), h1)
        self.assertNotEqual(h1, t1)
        self.assertEqual(len(h1), 64)

    def test_expiry(self):
        now = datetime(2026, 1, 1, 12, 0)
        self.assertFalse(core.is_expired(now + timedelta(minutes=1), now))
        self.assertTrue(core.is_expired(now, now))
        self.assertTrue(core.is_expired(now - timedelta(seconds=1), now))

    def test_link_url(self):
        self.assertEqual(core.magic_link_url('https://app.example.com/', 'abc'), 'https://app.example.com/?magic=abc')


class Usernames(unittest.TestCase):
    def test_derived_from_email_and_cleaned(self):
        self.assertEqual(core.base_username('Alex.Morgan+news@Acme.io'), 'alex.morgannews')
        self.assertEqual(core.base_username('@x.com'), 'user')
        self.assertLessEqual(len(core.base_username('a' * 80 + '@x.com')), 30)

    def test_picks_a_free_one(self):
        taken = {'alex', 'alex2', 'alex3'}
        self.assertEqual(core.pick_username('alex@x.com', lambda u: u in taken), 'alex4')
        self.assertEqual(core.pick_username('sam@x.com', lambda u: u in taken), 'sam')

    def test_falls_back_to_random_suffix_when_everything_is_taken(self):
        name = core.pick_username('alex@x.com', lambda u: u == 'alex' or (u.startswith('alex') and u[4:].isdigit()))
        self.assertTrue(name.startswith('alex-'))

    def test_split_name(self):
        self.assertEqual(core.split_name('Alex Morgan'), ('Alex', 'Morgan'))
        self.assertEqual(core.split_name('  Cher '), ('Cher', ''))
        self.assertEqual(core.split_name('Mary Jane Watson'), ('Mary', 'Jane Watson'))
        self.assertEqual(core.split_name(''), ('', ''))


class Errors(unittest.TestCase):
    def test_flattens_drf_errors_to_one_message_per_field(self):
        errors = {'email': ['Taken.', 'Other'], 'password': ['Too short.'], 'non_field_errors': ['x'], 'name': []}
        self.assertEqual(core.first_messages(errors), {'email': 'Taken.', 'password': 'Too short.'})

    def test_error_body_shape(self):
        self.assertEqual(core.error_body('invalid_token', 'Expired.'), {'code': 'invalid_token', 'detail': 'Expired.'})
        self.assertEqual(core.error_body('validation_error', 'Fix it.', {'email': 'Bad'})['fields'], {'email': 'Bad'})


class FakeResponse:
    def __init__(self, body, status=200):
        self._body, self.status_code = body, status

    def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


class FakeHttp:
    def __init__(self, routes):
        self.routes, self.calls = routes, []

    def _hit(self, method, url, **kw):
        self.calls.append((method, url, kw))
        return self.routes[(method, url)]

    def post(self, url, **kw):
        return self._hit('POST', url, **kw)

    def get(self, url, **kw):
        return self._hit('GET', url, **kw)


KW = dict(client_id='id', client_secret='secret')


class OAuth(unittest.TestCase):
    def github(self, emails, token='gho_x'):
        return FakeHttp({
            ('POST', oauth.GITHUB_TOKEN_URL): FakeResponse({'access_token': token} if token else {'error': 'bad_verification_code'}),
            ('GET', oauth.GITHUB_USER_URL): FakeResponse({'id': 42, 'login': 'alexm', 'name': 'Alex Morgan'}),
            ('GET', oauth.GITHUB_EMAILS_URL): FakeResponse(emails),
        })

    def test_github_uses_the_primary_verified_email(self):
        http = self.github([{'email': 'old@x.com', 'verified': True, 'primary': False}, {'email': 'main@x.com', 'verified': True, 'primary': True}])
        p = oauth.fetch_profile('github', 'code', 'https://app/cb', http=http, **KW)
        self.assertEqual((p.email, p.name, p.subject), ('main@x.com', 'Alex Morgan', '42'))
        self.assertEqual(http.calls[0][2]['data']['redirect_uri'], 'https://app/cb')

    def test_github_rejects_accounts_without_a_verified_email(self):
        with self.assertRaises(oauth.OAuthError) as cm:
            oauth.fetch_profile('github', 'c', 'u', http=self.github([{'email': 'a@x.com', 'verified': False, 'primary': True}]), **KW)
        self.assertEqual(cm.exception.code, 'email_unverified')

    def test_github_bad_code(self):
        with self.assertRaises(oauth.OAuthError) as cm:
            oauth.fetch_profile('github', 'c', 'u', http=self.github([], token=None), **KW)
        self.assertEqual(cm.exception.code, 'oauth_failed')

    def test_google_requires_a_verified_email(self):
        def google(info):
            return FakeHttp({('POST', oauth.GOOGLE_TOKEN_URL): FakeResponse({'access_token': 'ya29'}), ('GET', oauth.GOOGLE_USERINFO_URL): FakeResponse(info)})
        p = oauth.fetch_profile('google', 'c', 'u', http=google({'sub': '9', 'email': 'a@x.com', 'email_verified': True, 'name': 'Alex'}), **KW)
        self.assertEqual((p.email, p.provider), ('a@x.com', 'google'))
        with self.assertRaises(oauth.OAuthError) as cm:
            oauth.fetch_profile('google', 'c', 'u', http=google({'sub': '9', 'email': 'a@x.com', 'email_verified': False}), **KW)
        self.assertEqual(cm.exception.code, 'email_unverified')

    def test_provider_errors_and_network_failures_become_oauth_failed(self):
        class Boom:
            def post(self, *a, **k):
                raise TimeoutError('slow')
        with self.assertRaises(oauth.OAuthError):
            oauth.fetch_profile('google', 'c', 'u', http=Boom(), **KW)
        http = FakeHttp({('POST', oauth.GOOGLE_TOKEN_URL): FakeResponse({}, status=400)})
        with self.assertRaises(oauth.OAuthError):
            oauth.fetch_profile('google', 'c', 'u', http=http, **KW)

    def test_unconfigured_or_unknown_providers(self):
        with self.assertRaises(oauth.OAuthError):
            oauth.fetch_profile('github', 'c', 'u', http=None, client_id='', client_secret='')
        with self.assertRaises(oauth.OAuthError):
            oauth.fetch_profile('twitter', 'c', 'u', http=None, **KW)

    def test_redirect_allowlist_is_exact(self):
        allowed = ['https://app.example.com/auth/callback']
        self.assertTrue(oauth.redirect_allowed('https://app.example.com/auth/callback', allowed))
        self.assertFalse(oauth.redirect_allowed('https://app.example.com/auth/callback/', allowed))
        self.assertFalse(oauth.redirect_allowed('https://evil.example/auth/callback', allowed))
        self.assertFalse(oauth.redirect_allowed('', allowed))


if __name__ == '__main__':
    unittest.main()
