"""Unit tests for the passkey ceremony rules. No Django, no webauthn package needed:

    python -m unittest accounts.test_passkey_core

A fake adapter stands in for the cryptography, so these tests prove OUR rules (single-use challenges, expiry,
user binding, counter policy, same error for every failure). They do not prove that the real library accepts a real
authenticator's response: that needs the integration test in tests_passkey_api.py and a browser.
"""
import secrets
import unittest
from datetime import datetime, timedelta

from accounts.passkey_core import (
    CHALLENGE_TTL, MAX_PASSKEYS_PER_USER, CredentialRecord, PasskeyError, PasskeyService, RelyingParty,
    StoredChallenge, UserInfo, VerificationFailed, VerifiedAuthentication, VerifiedRegistration,
    b64url_decode, b64url_encode, clean_label, clean_transports, counter_ok,
)

RP = RelyingParty(rp_id='bukmarkz.com', name='Bukmarkz', origins=['https://www.bukmarkz.com'])
T0 = datetime(2026, 10, 20, 9, 0, 0)


class FakeAdapter:
    """"Verifies" a credential by comparing a marker the test put in it, and records what it was asked."""

    def __init__(self):
        self.reg_calls = []
        self.auth_calls = []
        self.next_counter = 0
        self.reject = False

    def registration_options(self, rp, user_handle, user_name, display_name, exclude_ids, challenge):
        self.reg_calls.append({'handle': user_handle, 'name': user_name, 'exclude': exclude_ids})
        return {'challenge': b64url_encode(challenge), 'rp': {'id': rp.rp_id}, 'user': {'id': b64url_encode(user_handle), 'name': user_name}}

    def verify_registration(self, credential, challenge, rp):
        if self.reject or credential.get('ok') is not True:
            raise VerificationFailed('bad')
        return VerifiedRegistration(credential_id=b64url_decode(credential['id']), public_key=b'PUBKEY', sign_count=0,
                                    device_type='multi_device', backed_up=True, aaguid='00000000-0000-0000-0000-000000000000')

    def authentication_options(self, rp, challenge):
        self.auth_calls.append('options')
        return {'challenge': b64url_encode(challenge), 'rpId': rp.rp_id, 'allowCredentials': []}

    def verify_authentication(self, credential, challenge, rp, public_key, sign_count):
        if self.reject or credential.get('ok') is not True:
            raise VerificationFailed('bad')
        return VerifiedAuthentication(new_sign_count=self.next_counter, device_type='multi_device', backed_up=True)


class MemChallenges:
    def __init__(self):
        self.rows = {}

    def put(self, c):
        self.rows[c.challenge_id] = c

    def take(self, cid):
        return self.rows.pop(cid, None)


class MemCredentials:
    def __init__(self):
        self.rows = {}

    def list_for_user(self, user_id):
        return [r for r in self.rows.values() if r.user_id == user_id]

    def get_by_credential_id(self, cid):
        return self.rows.get(cid)

    def add(self, record):
        record.pk = len(self.rows) + 1
        self.rows[record.credential_id] = record
        return record

    def record_login(self, cid, sign_count, backed_up, when):
        r = self.rows[cid]
        r.sign_count, r.backed_up, r.last_used_at = sign_count, backed_up, when


class MemUsers:
    def __init__(self):
        self.handles = {}
        self.infos = {1: UserInfo(1, 'alex', 'Alex Morgan', True), 2: UserInfo(2, 'sam', 'Sam Lee', True)}

    def user_handle(self, user_id):
        return self.handles.setdefault(user_id, secrets.token_bytes(32))

    def user_info(self, user_id):
        return self.infos.get(user_id)


class Clock:
    def __init__(self):
        self.t = T0

    def __call__(self):
        return self.t


class Base(unittest.TestCase):
    def setUp(self):
        self.adapter, self.challenges, self.creds, self.users, self.clock = FakeAdapter(), MemChallenges(), MemCredentials(), MemUsers(), Clock()
        self.n = 0
        self.svc = PasskeyService(RP, self.adapter, self.challenges, self.creds, self.users, now=self.clock, token=self._token)

    def _token(self):
        self.n += 1
        return 'challenge-%04d-xxxxxxxx' % self.n

    def register(self, user_id=1, cred_id=b'cred-one', label=None):
        began = self.svc.begin_registration(user_id)
        return self.svc.finish_registration(user_id, began['challenge_id'], {'id': b64url_encode(cred_id), 'ok': True, 'response': {'transports': ['internal', 'hybrid', 'evil']}}, label)


class TestHelpers(unittest.TestCase):
    def test_base64url_roundtrip_and_strictness(self):
        raw = bytes(range(256))
        self.assertEqual(b64url_decode(b64url_encode(raw)), raw)
        for bad in ('a+b/', 'abc=', 'a', 12, None, 'x' * 5000, 'ab cd'):
            with self.assertRaises(PasskeyError):
                b64url_decode(bad)

    def test_counter_policy(self):
        self.assertTrue(counter_ok(0, 0))        # synced passkeys never count
        self.assertTrue(counter_ok(0, 1))
        self.assertTrue(counter_ok(5, 6))
        self.assertFalse(counter_ok(5, 5))       # same number twice: a replay
        self.assertFalse(counter_ok(5, 4))       # went backwards: a cloned authenticator
        self.assertFalse(counter_ok(5, 0))       # reset to zero after counting: also suspicious

    def test_labels_and_transports(self):
        self.assertEqual(clean_label('  My\x00 <b>Mac</b>\n book ', 'x'), 'My bMac/b book')
        self.assertEqual(clean_label('', 'fallback'), 'fallback')
        self.assertEqual(clean_label(None, 'fallback'), 'fallback')
        self.assertEqual(len(clean_label('a' * 500, 'x')), 64)
        self.assertEqual(clean_transports(['internal', 'internal', 'evil', 3, 'usb']), ['internal', 'usb'])
        self.assertEqual(clean_transports('usb'), [])


class TestRegistration(Base):
    def test_happy_path_stores_a_clean_record(self):
        rec = self.register(label='  MacBook  ')
        self.assertEqual(rec.label, 'MacBook')
        self.assertEqual(rec.transports, ['internal', 'hybrid'])
        self.assertEqual(rec.public_key, b'PUBKEY')
        self.assertEqual((rec.device_type, rec.backed_up), ('multi_device', True))
        self.assertEqual(self.creds.list_for_user(1)[0].user_id, 1)

    def test_default_label_has_the_date(self):
        self.assertEqual(self.register().label, 'Passkey added 20 Oct 2026')

    def test_user_handle_is_random_stable_and_not_personal(self):
        self.register()
        handle = self.adapter.reg_calls[0]['handle']
        self.assertEqual(len(handle), 32)
        for personal in (b'alex', b'Alex Morgan', b'alex@example.com'):  # a 1-byte id like b'1' would match random bytes ~12% of the time
            self.assertNotIn(personal, handle)
        self.assertEqual(self.users.user_handle(1), handle)

    def test_existing_passkeys_are_excluded_so_one_device_cannot_register_twice(self):
        self.register(cred_id=b'cred-one')
        self.svc.begin_registration(1)
        self.assertEqual(self.adapter.reg_calls[1]['exclude'], [b'cred-one'])

    def test_challenge_works_once(self):
        began = self.svc.begin_registration(1)
        cred = {'id': b64url_encode(b'c1'), 'ok': True}
        self.svc.finish_registration(1, began['challenge_id'], cred)
        with self.assertRaises(PasskeyError) as ctx:
            self.svc.finish_registration(1, began['challenge_id'], {'id': b64url_encode(b'c2'), 'ok': True})
        self.assertEqual(ctx.exception.code, 'challenge_invalid')

    def test_a_failed_attempt_burns_the_challenge(self):
        began = self.svc.begin_registration(1)
        with self.assertRaises(PasskeyError) as ctx:
            self.svc.finish_registration(1, began['challenge_id'], {'id': b64url_encode(b'c1'), 'ok': False})
        self.assertEqual(ctx.exception.code, 'passkey_failed')
        with self.assertRaises(PasskeyError) as again:
            self.svc.finish_registration(1, began['challenge_id'], {'id': b64url_encode(b'c1'), 'ok': True})
        self.assertEqual(again.exception.code, 'challenge_invalid')

    def test_expired_challenge(self):
        began = self.svc.begin_registration(1)
        self.clock.t = T0 + CHALLENGE_TTL + timedelta(seconds=1)
        with self.assertRaises(PasskeyError) as ctx:
            self.svc.finish_registration(1, began['challenge_id'], {'id': b64url_encode(b'c1'), 'ok': True})
        self.assertEqual(ctx.exception.code, 'challenge_invalid')

    def test_challenge_cannot_be_used_by_another_user(self):
        began = self.svc.begin_registration(1)
        with self.assertRaises(PasskeyError) as ctx:
            self.svc.finish_registration(2, began['challenge_id'], {'id': b64url_encode(b'c1'), 'ok': True})
        self.assertEqual(ctx.exception.code, 'challenge_invalid')
        self.assertEqual(self.creds.list_for_user(2), [])

    def test_a_login_challenge_cannot_register(self):
        began = self.svc.begin_login()
        with self.assertRaises(PasskeyError) as ctx:
            self.svc.finish_registration(1, began['challenge_id'], {'id': b64url_encode(b'c1'), 'ok': True})
        self.assertEqual(ctx.exception.code, 'challenge_invalid')

    def test_duplicate_credential_is_refused(self):
        self.register(cred_id=b'same')
        with self.assertRaises(PasskeyError) as ctx:
            self.register(user_id=2, cred_id=b'same')
        self.assertEqual(ctx.exception.code, 'already_registered')

    def test_limit(self):
        for i in range(MAX_PASSKEYS_PER_USER):
            self.register(cred_id=b'c%d' % i)
        with self.assertRaises(PasskeyError) as ctx:
            self.svc.begin_registration(1)
        self.assertEqual(ctx.exception.code, 'limit_reached')

    def test_garbage_input_is_a_clean_error(self):
        began = self.svc.begin_registration(1)
        for challenge_id, credential in (('', {}), (None, {}), (12, {}), (began['challenge_id'], 'not a dict')):
            with self.assertRaises(PasskeyError):
                self.svc.finish_registration(1, challenge_id, credential)

    def test_inactive_or_missing_user_cannot_start(self):
        self.users.infos[1].is_active = False
        with self.assertRaises(PasskeyError):
            self.svc.begin_registration(1)
        with self.assertRaises(PasskeyError):
            self.svc.begin_registration(99)


class TestLogin(Base):
    def login_with(self, cred_id=b'cred-one', extra=None, ok=True):
        began = self.svc.begin_login()
        credential = {'id': b64url_encode(cred_id), 'ok': ok, 'response': {}}
        credential['response'].update(extra or {})
        return self.svc.finish_login(began['challenge_id'], credential)

    def test_happy_path_returns_the_owner_and_updates_the_record(self):
        self.register()
        self.adapter.next_counter = 0
        self.clock.t = T0 + timedelta(hours=1)
        self.assertEqual(self.login_with(), 1)
        rec = self.creds.get_by_credential_id(b64url_encode(b'cred-one'))
        self.assertEqual(rec.last_used_at, T0 + timedelta(hours=1))

    def test_login_options_do_not_depend_on_any_account(self):
        self.svc.begin_login()
        self.assertEqual(self.adapter.auth_calls, ['options'])   # no email or user was passed in, so nothing can leak

    def test_unknown_credential_and_bad_signature_look_the_same(self):
        self.register()
        with self.assertRaises(PasskeyError) as unknown:
            self.login_with(cred_id=b'nobody')
        with self.assertRaises(PasskeyError) as bad_sig:
            self.login_with(ok=False)
        self.assertEqual((unknown.exception.code, unknown.exception.detail), (bad_sig.exception.code, bad_sig.exception.detail))
        self.assertEqual(unknown.exception.code, 'passkey_failed')

    def test_user_handle_must_match_the_credentials_owner(self):
        self.register(user_id=1)
        self.assertEqual(self.login_with(extra={'userHandle': b64url_encode(self.users.user_handle(1))}), 1)
        with self.assertRaises(PasskeyError) as ctx:
            self.login_with(extra={'userHandle': b64url_encode(self.users.user_handle(2))})
        self.assertEqual(ctx.exception.code, 'passkey_failed')
        with self.assertRaises(PasskeyError):
            self.login_with(extra={'userHandle': '!!not base64!!'})

    def test_disabled_account_cannot_sign_in(self):
        self.register()
        self.users.infos[1].is_active = False
        with self.assertRaises(PasskeyError) as ctx:
            self.login_with()
        self.assertEqual(ctx.exception.code, 'passkey_failed')

    def test_counter_going_backwards_is_refused_and_not_saved(self):
        self.register()
        self.adapter.next_counter = 10
        self.login_with()
        self.adapter.next_counter = 9
        with self.assertRaises(PasskeyError):
            self.login_with()
        self.assertEqual(self.creds.get_by_credential_id(b64url_encode(b'cred-one')).sign_count, 10)

    def test_synced_passkeys_with_counter_zero_keep_working(self):
        self.register()
        self.adapter.next_counter = 0
        for _ in range(3):
            self.assertEqual(self.login_with(), 1)

    def test_challenge_is_single_use_for_login_too(self):
        self.register()
        began = self.svc.begin_login()
        cred = {'id': b64url_encode(b'cred-one'), 'ok': True, 'response': {}}
        self.svc.finish_login(began['challenge_id'], cred)
        with self.assertRaises(PasskeyError) as ctx:
            self.svc.finish_login(began['challenge_id'], cred)
        self.assertEqual(ctx.exception.code, 'challenge_invalid')

    def test_a_failed_login_burns_its_challenge(self):
        self.register()
        began = self.svc.begin_login()
        with self.assertRaises(PasskeyError):
            self.svc.finish_login(began['challenge_id'], {'id': b64url_encode(b'cred-one'), 'ok': False})
        with self.assertRaises(PasskeyError) as ctx:
            self.svc.finish_login(began['challenge_id'], {'id': b64url_encode(b'cred-one'), 'ok': True})
        self.assertEqual(ctx.exception.code, 'challenge_invalid')

    def test_a_registration_challenge_cannot_log_in(self):
        self.register()
        began = self.svc.begin_registration(1)
        with self.assertRaises(PasskeyError) as ctx:
            self.svc.finish_login(began['challenge_id'], {'id': b64url_encode(b'cred-one'), 'ok': True})
        self.assertEqual(ctx.exception.code, 'challenge_invalid')

    def test_malformed_credentials(self):
        began = self.svc.begin_login()
        with self.assertRaises(PasskeyError):
            self.svc.finish_login(began['challenge_id'], ['list'])
        began = self.svc.begin_login()
        with self.assertRaises(PasskeyError):
            self.svc.finish_login(began['challenge_id'], {'id': 5})


if __name__ == '__main__':
    unittest.main()
