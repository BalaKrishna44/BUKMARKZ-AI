"""API tests for sign-in, sign-up, magic link, OAuth and password reset.

NOTE: written without being able to run Django in the review environment (the pure helpers are covered by
accounts.test_auth_core, which does run anywhere). Run `python manage.py test accounts` and fix anything that differs.
"""
from datetime import timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from knox.models import AuthToken
from rest_framework.test import APITestCase

from accounts.auth_core import hash_token
from accounts.models import MagicLink
from accounts.oauth_core import OAuthError, OAuthProfile

User = get_user_model()
STRONG = 'Str0ng!Passw0rd-xyz'


class PasswordAuthTests(APITestCase):
    def register(self, **over):
        body = {'name': 'Alex Morgan', 'email': 'Alex@Example.com', 'password': STRONG}
        body.update(over)
        return self.client.post('/api/auth/register/', body, format='json')

    def test_register_by_name_and_email_returns_a_session(self):
        r = self.register()
        self.assertEqual(r.status_code, 201)
        self.assertTrue(r.data['created'])
        self.assertEqual(r.data['user']['email'], 'alex@example.com')       # stored lower-case
        self.assertEqual(r.data['user']['name'], 'Alex Morgan')
        user = User.objects.get(email='alex@example.com')
        self.assertEqual(user.username, 'alex')                              # derived, nobody has to invent one
        self.assertFalse(user.email_verified)                                # a password sign-up does not prove the mailbox

    def test_register_reports_a_taken_email_with_its_own_code(self):
        self.register()
        r = self.register(email='ALEX@example.com')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data['code'], 'email_taken')
        self.assertIn('email', r.data['fields'])

    def test_register_returns_field_messages_for_weak_passwords_and_missing_names(self):
        r = self.register(password='12345678')
        self.assertEqual(r.data['code'], 'validation_error')
        self.assertIn('password', r.data['fields'])
        r = self.register(name='')
        self.assertIn('name', r.data['fields'])

    def test_login_by_email_is_case_insensitive(self):
        self.register()
        r = self.client.post('/api/auth/login/', {'email': 'ALEX@example.com', 'password': STRONG}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data['token'])
        self.assertFalse(r.data['created'])

    def test_legacy_username_login_still_works(self):
        self.register()
        r = self.client.post('/api/auth/login/', {'username': 'alex', 'password': STRONG}, format='json')
        self.assertEqual(r.status_code, 200)

    def test_every_login_failure_looks_the_same(self):
        self.register()
        wrong = self.client.post('/api/auth/login/', {'email': 'alex@example.com', 'password': 'nope-nope-nope'}, format='json')
        unknown = self.client.post('/api/auth/login/', {'email': 'nobody@example.com', 'password': 'nope-nope-nope'}, format='json')
        self.assertEqual(wrong.status_code, 400)
        self.assertEqual(wrong.data, unknown.data)
        self.assertEqual(wrong.data['code'], 'invalid_credentials')

    def test_a_stale_authorization_header_does_not_break_public_endpoints(self):
        self.client.credentials(HTTP_AUTHORIZATION='Token deadbeef')
        self.assertEqual(self.register().status_code, 201)


class MagicLinkTests(APITestCase):
    def request_link(self, email='sam@example.com', mode='signin', name=''):
        with mock.patch('accounts.views.send_email') as send:
            r = self.client.post('/api/auth/magic-link/', {'email': email, 'mode': mode, 'name': name}, format='json')
        return r, send

    def issue_token(self, email='sam@example.com', allow_signup=False, name='', expires_in=15, used=False):
        token = 'tok-' + email
        MagicLink.objects.create(
            email=email, name=name, token_hash=hash_token(token), allow_signup=allow_signup,
            expires=timezone.now() + timedelta(minutes=expires_in), used_at=timezone.now() if used else None)
        return token

    def verify(self, token):
        return self.client.post('/api/auth/magic-link/verify/', {'token': token}, format='json')

    def test_signin_link_is_only_sent_to_existing_accounts_but_the_answer_never_differs(self):
        User.objects.create_user('sam', 'sam@example.com', 'x', email_verified=True)
        known, sent_known = self.request_link('sam@example.com')
        unknown, sent_unknown = self.request_link('ghost@example.com')
        self.assertEqual(known.status_code, 200)
        self.assertEqual(known.data, unknown.data)
        sent_known.assert_called_once()
        sent_unknown.assert_not_called()
        self.assertEqual(MagicLink.objects.filter(email='ghost@example.com').count(), 0)

    def test_only_a_hash_is_stored_and_the_email_carries_the_token(self):
        User.objects.create_user('sam', 'sam@example.com', 'x', email_verified=True)
        _, send = self.request_link('sam@example.com')
        data = send.call_args[0][0]
        token = data['url'].split('?magic=')[1]
        link = MagicLink.objects.get(email='sam@example.com')
        self.assertEqual(link.token_hash, hash_token(token))
        self.assertNotIn(token, link.token_hash)

    def test_validation_errors(self):
        self.assertEqual(self.request_link('not-an-email')[0].status_code, 400)
        r, _ = self.request_link('new@example.com', mode='signup', name='')
        self.assertEqual(r.status_code, 400)
        self.assertIn('name', r.data['fields'])

    def test_a_newer_link_replaces_older_ones(self):
        User.objects.create_user('sam', 'sam@example.com', 'x', email_verified=True)
        self.request_link()
        first = MagicLink.objects.get()
        self.request_link()
        first.refresh_from_db()
        self.assertIsNotNone(first.used_at)

    def test_links_per_email_are_rate_limited(self):
        User.objects.create_user('sam', 'sam@example.com', 'x', email_verified=True)
        for _ in range(8):
            self.request_link()
        self.assertEqual(MagicLink.objects.filter(email='sam@example.com').count(), 5)

    def test_verify_signs_in_and_the_link_works_once(self):
        User.objects.create_user('sam', 'sam@example.com', 'x', email_verified=True)
        token = self.issue_token()
        r = self.verify(token)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data['token'])
        self.assertFalse(r.data['created'])
        again = self.verify(token)
        self.assertEqual(again.status_code, 400)
        self.assertEqual(again.data['code'], 'invalid_token')

    def test_expired_unknown_and_garbage_tokens_are_rejected_identically(self):
        User.objects.create_user('sam', 'sam@example.com', 'x', email_verified=True)
        expired = self.issue_token(expires_in=-1)
        results = [self.verify(expired), self.verify('nope'), self.client.post('/api/auth/magic-link/verify/', {}, format='json')]
        self.assertTrue(all(r.status_code == 400 and r.data['code'] == 'invalid_token' for r in results))

    def test_signup_link_creates_a_verified_account_with_the_given_name(self):
        token = self.issue_token('new@example.com', allow_signup=True, name='Jordan Lee')
        r = self.verify(token)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data['created'])
        user = User.objects.get(email='new@example.com')
        self.assertTrue(user.email_verified)
        self.assertFalse(user.has_usable_password())
        self.assertEqual(r.data['user']['name'], 'Jordan Lee')

    def test_a_signin_link_never_creates_an_account(self):
        token = self.issue_token('ghost@example.com', allow_signup=False)
        self.assertEqual(self.verify(token).status_code, 400)
        self.assertFalse(User.objects.filter(email='ghost@example.com').exists())

    def test_proving_the_mailbox_claims_an_unverified_account_and_clears_its_password(self):
        """Pre-hijacking: someone registered the victim's address with a password they know."""
        self.client.post('/api/auth/register/', {'name': 'Mallory', 'email': 'victim@example.com', 'password': STRONG}, format='json')
        token = self.issue_token('victim@example.com', allow_signup=True, name='Victim')
        self.assertEqual(self.verify(token).status_code, 200)
        user = User.objects.get(email='victim@example.com')
        self.assertFalse(user.has_usable_password())
        self.assertTrue(user.email_verified)
        self.assertEqual(self.client.post('/api/auth/login/', {'email': 'victim@example.com', 'password': STRONG}, format='json').status_code, 400)
        self.assertEqual(AuthToken.objects.filter(user=user).count(), 1)  # only the new session remains


@override_settings(OAUTH_ALLOWED_REDIRECTS=['https://app.example.com/auth/callback'], OAUTH_PROVIDERS={'github': {'client_id': 'i', 'client_secret': 's'}, 'google': {'client_id': 'i', 'client_secret': 's'}})
class OAuthTests(APITestCase):
    URL = '/api/auth/oauth/github/'
    GOOD = {'code': 'abc', 'redirect_uri': 'https://app.example.com/auth/callback'}

    def test_a_valid_code_signs_in_and_creates_a_verified_account(self):
        profile = OAuthProfile('github', '42', 'Alex@Example.com', 'Alex Morgan')
        with mock.patch('accounts.views.fetch_profile', return_value=profile):
            r = self.client.post(self.URL, self.GOOD, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data['created'])
        self.assertTrue(User.objects.get(email='alex@example.com').email_verified)

    def test_redirect_uri_must_be_on_the_allow_list(self):
        with mock.patch('accounts.views.fetch_profile') as fetch:
            r = self.client.post(self.URL, {'code': 'abc', 'redirect_uri': 'https://evil.example/cb'}, format='json')
        self.assertEqual(r.status_code, 400)
        fetch.assert_not_called()

    def test_provider_failures_are_reported(self):
        with mock.patch('accounts.views.fetch_profile', side_effect=OAuthError('email_unverified', 'No verified email.')):
            r = self.client.post(self.URL, self.GOOD, format='json')
        self.assertEqual((r.status_code, r.data['code']), (400, 'email_unverified'))

    def test_unknown_provider_and_missing_code(self):
        self.assertEqual(self.client.post('/api/auth/oauth/twitter/', self.GOOD, format='json').status_code, 400)
        self.assertEqual(self.client.post(self.URL, {'redirect_uri': self.GOOD['redirect_uri']}, format='json').status_code, 400)


class PasswordResetTests(APITestCase):
    def test_request_answers_200_whether_or_not_the_account_exists(self):
        User.objects.create_user('sam', 'sam@example.com', 'x')
        known = self.client.post('/api/password_reset/', {'email': 'sam@example.com'}, format='json')
        unknown = self.client.post('/api/password_reset/', {'email': 'ghost@example.com'}, format='json')
        self.assertEqual((known.status_code, unknown.status_code), (200, 200))

    def test_confirm_with_a_bad_token_is_not_found(self):
        r = self.client.post('/api/password_reset/confirm/', {'token': 'nope', 'password': STRONG}, format='json')
        self.assertEqual(r.status_code, 404)

    def test_resetting_marks_the_email_verified_and_signs_out_old_sessions(self):
        from django_rest_passwordreset.models import ResetPasswordToken
        user = User.objects.create_user('sam', 'sam@example.com', 'old-Passw0rd!')
        AuthToken.objects.create(user)
        token = ResetPasswordToken.objects.create(user=user)
        r = self.client.post('/api/password_reset/confirm/', {'token': token.key, 'password': STRONG}, format='json')
        self.assertEqual(r.status_code, 200)
        user.refresh_from_db()
        self.assertTrue(user.email_verified)
        self.assertEqual(AuthToken.objects.filter(user=user).count(), 0)
