"""API tests for the passkey endpoints. NOT RUN yet: the environment this was written in has no Django installed.
Run with `python manage.py test accounts.tests_passkey_api`.

A fake adapter replaces the `webauthn` package, so these prove the HTTP layer and the database stores (single-use
challenges, ownership, session body), not the real cryptography. For that, test once in a browser with a real
authenticator (Chrome DevTools > WebAuthn can add a virtual one) and with 1Password, iCloud Keychain and Google Password Manager.
"""
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts import passkey_views
from accounts.models import PasskeyChallenge, PasskeyCredential
from accounts.passkey_core import (
    PasskeyService, RelyingParty, VerificationFailed, VerifiedAuthentication, VerifiedRegistration, b64url_encode,
)
from accounts.passkey_stores import DbChallengeStore, DbCredentialStore, DbUserDirectory, utcnow

RP = RelyingParty(rp_id='testserver', name='Bukmarkz', origins=['http://testserver'])


class FakeAdapter:
    def registration_options(self, rp, user_handle, user_name, display_name, exclude_ids, challenge):
        return {'challenge': b64url_encode(challenge), 'rp': {'id': rp.rp_id}}

    def verify_registration(self, credential, challenge, rp):
        if credential.get('ok') is not True:
            raise VerificationFailed('bad')
        return VerifiedRegistration(b'cred-' + credential['id'].encode(), b'KEY', 0, 'multi_device', True, '')

    def authentication_options(self, rp, challenge):
        return {'challenge': b64url_encode(challenge), 'rpId': rp.rp_id}

    def verify_authentication(self, credential, challenge, rp, public_key, sign_count):
        if credential.get('ok') is not True:
            raise VerificationFailed('bad')
        return VerifiedAuthentication(0, 'multi_device', True)


class PasskeyApiTests(TestCase):
    def setUp(self):
        passkey_views.service_factory = lambda: PasskeyService(RP, FakeAdapter(), DbChallengeStore(), DbCredentialStore(), DbUserDirectory(), now=utcnow)
        self.addCleanup(setattr, passkey_views, 'service_factory', None)
        User = get_user_model()
        self.alex = User.objects.create_user('alex', 'alex@example.com', 'x')
        self.sam = User.objects.create_user('sam', 'sam@example.com', 'x')
        self.anon = APIClient()
        self.alex_client = APIClient()
        self.alex_client.force_authenticate(self.alex)

    def register(self, client, cred_id='one', label='MacBook'):
        opts = client.post('/api/auth/passkeys/register/options/', {}, format='json')
        self.assertEqual(opts.status_code, 200, opts.content)
        return client.post('/api/auth/passkeys/register/verify/', {
            'challenge_id': opts.data['challenge_id'], 'label': label,
            'credential': {'id': b64url_encode(cred_id.encode()), 'ok': True, 'response': {'transports': ['internal']}}}, format='json')

    def test_registering_needs_a_session(self):
        self.assertIn(self.anon.post('/api/auth/passkeys/register/options/', {}, format='json').status_code, (401, 403))

    def test_register_then_sign_in_returns_the_normal_session_body(self):
        created = self.register(self.alex_client)
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(created.data['label'], 'MacBook')
        self.assertNotIn('public_key', created.data)
        opts = self.anon.post('/api/auth/passkeys/login/options/', {}, format='json')
        self.assertEqual(opts.status_code, 200)
        cred_id = PasskeyCredential.objects.get().credential_id
        res = self.anon.post('/api/auth/passkeys/login/verify/', {'challenge_id': opts.data['challenge_id'], 'credential': {'id': cred_id, 'ok': True, 'response': {}}}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data['user']['email'], 'alex@example.com')
        self.assertTrue(res.data['token'])

    def test_a_challenge_cannot_be_replayed(self):
        self.register(self.alex_client)
        cred_id = PasskeyCredential.objects.get().credential_id
        opts = self.anon.post('/api/auth/passkeys/login/options/', {}, format='json')
        body = {'challenge_id': opts.data['challenge_id'], 'credential': {'id': cred_id, 'ok': True, 'response': {}}}
        self.assertEqual(self.anon.post('/api/auth/passkeys/login/verify/', body, format='json').status_code, 200)
        again = self.anon.post('/api/auth/passkeys/login/verify/', body, format='json')
        self.assertEqual(again.status_code, 400)
        self.assertEqual(again.data['code'], 'challenge_invalid')
        self.assertEqual(PasskeyChallenge.objects.count(), 0)

    def test_failed_sign_in_gives_one_generic_error(self):
        opts = self.anon.post('/api/auth/passkeys/login/options/', {}, format='json')
        res = self.anon.post('/api/auth/passkeys/login/verify/', {'challenge_id': opts.data['challenge_id'], 'credential': {'id': 'bm9ib2R5', 'ok': True}}, format='json')
        self.assertEqual((res.status_code, res.data['code']), (400, 'passkey_failed'))

    def test_one_person_cannot_see_rename_or_delete_anothers_passkey(self):
        self.register(self.alex_client)
        pk = PasskeyCredential.objects.get().pk
        sam = APIClient()
        sam.force_authenticate(self.sam)
        self.assertEqual(sam.get('/api/auth/passkeys/').data, [])
        self.assertEqual(sam.patch('/api/auth/passkeys/%d/' % pk, {'label': 'mine now'}, format='json').status_code, 404)
        self.assertEqual(sam.delete('/api/auth/passkeys/%d/' % pk).status_code, 404)
        self.assertEqual(PasskeyCredential.objects.count(), 1)

    def test_rename_and_delete(self):
        self.register(self.alex_client)
        pk = PasskeyCredential.objects.get().pk
        res = self.alex_client.patch('/api/auth/passkeys/%d/' % pk, {'label': '  Work <laptop>  '}, format='json')
        self.assertEqual(res.data['label'], 'Work laptop')
        self.assertEqual(self.alex_client.delete('/api/auth/passkeys/%d/' % pk).status_code, 204)
        self.assertEqual(self.alex_client.get('/api/auth/passkeys/').data, [])

    def test_unconfigured_server_fails_loudly(self):
        passkey_views.service_factory = None
        with override_settings(WEBAUTHN_RP_ID='', WEBAUTHN_ORIGINS=[]):
            from django.core.exceptions import ImproperlyConfigured
            with self.assertRaises(ImproperlyConfigured):
                passkey_views.get_service()
