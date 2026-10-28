"""Passkey (WebAuthn) ceremonies, with no Django and no WebAuthn-library imports.

Everything security-relevant that is NOT cryptography lives here so it can be unit-tested anywhere:

    python -m unittest accounts.test_passkey_core

The cryptography (parsing attestation, checking signatures, origin and RP ID hash) is done by the `webauthn`
package behind the `WebAuthnAdapter` interface (see passkey_webauthn.py). The database sits behind the three
store interfaces (see passkey_stores.py). This module decides:

  * challenges are random, bound to a purpose (and to a user when registering), expire after 5 minutes and work ONCE
    (they are deleted before verification starts, so a failed attempt cannot be retried against the same challenge);
  * a login finds the account from the credential itself (discoverable credentials), so the endpoint never takes an
    email address and cannot be used to find out who has an account;
  * every verification failure looks the same to the caller (`passkey_failed`), whatever the real reason;
  * the signature counter is checked (a counter that goes backwards means a cloned authenticator), but a counter that
    is always 0 is accepted, because synced passkeys (Apple, Google, 1Password) never count;
  * the user handle returned by the authenticator must belong to the credential's owner;
  * the user handle is a random 32-byte value, never an email, username or database id (WebAuthn forbids personal data).
"""
import base64
import re
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Protocol

CHALLENGE_TTL = timedelta(minutes=5)
MAX_PASSKEYS_PER_USER = 10
LABEL_MAX = 64
KNOWN_TRANSPORTS = ('usb', 'nfc', 'ble', 'internal', 'hybrid', 'smart-card')

PURPOSE_REGISTER = 'register'
PURPOSE_LOGIN = 'login'

PUBLIC_MESSAGES = {
    'challenge_invalid': 'That request expired. Please try again.',
    'passkey_failed': 'The passkey could not be verified. Try again, or sign in another way.',
    'limit_reached': 'You have reached the limit of %d passkeys. Remove one first.' % MAX_PASSKEYS_PER_USER,
    'already_registered': 'This passkey is already saved to your account.',
    'bad_request': 'The request was not valid.',
    'not_found': 'Passkey not found.',
}


class PasskeyError(Exception):
    """An error that is safe to show to the caller. `code` is stable; `detail` is a fixed sentence (never built from input)."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code
        self.detail = PUBLIC_MESSAGES.get(code, PUBLIC_MESSAGES['bad_request'])


class VerificationFailed(Exception):
    """Raised by the adapter when the library rejects a response (bad signature, wrong origin, wrong challenge...)."""


# --------------------------------------------------------------------------------------------- small helpers

def b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode('ascii')


_B64URL = re.compile(r'^[A-Za-z0-9_-]*$')


def b64url_decode(value: Any) -> bytes:
    """Strict base64url (RFC 4648 section 5) without padding. Anything else is a bad request, never a 500."""
    if not isinstance(value, str) or not _B64URL.match(value) or len(value) % 4 == 1 or len(value) > 4096:
        raise PasskeyError('bad_request')
    return base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))


def counter_ok(stored: int, new: int) -> bool:
    """W3C WebAuthn: if either counter is non-zero, the new one must be larger. Both zero means the authenticator
    does not count (every synced passkey), which is normal."""
    if stored == 0 and new == 0:
        return True
    return new > stored


def clean_label(label: Any, fallback: str) -> str:
    """A name people give a passkey ("MacBook", "1Password"). Plain text only: control characters and angle brackets removed."""
    if not isinstance(label, str):
        return fallback
    text = re.sub(r'[\x00-\x1f\x7f<>]', '', label)
    text = re.sub(r'\s+', ' ', text).strip()[:LABEL_MAX]
    return text or fallback


def clean_transports(raw: Any) -> List[str]:
    if not isinstance(raw, (list, tuple)):
        return []
    return [t for t in dict.fromkeys(raw) if isinstance(t, str) and t in KNOWN_TRANSPORTS]


# --------------------------------------------------------------------------------------------- data shapes

@dataclass(frozen=True)
class RelyingParty:
    rp_id: str                      # the registrable domain, e.g. "bukmarkz.com" (no scheme, no port)
    name: str                       # shown by the authenticator, e.g. "Bukmarkz"
    origins: List[str]              # exact origins allowed to run the ceremony, e.g. ["https://www.bukmarkz.com"]
    user_verification: str = 'required'   # 'required' | 'preferred' | 'discouraged'


@dataclass
class StoredChallenge:
    challenge_id: str
    purpose: str
    challenge: bytes
    user_id: Optional[int]
    expires_at: datetime


@dataclass
class UserInfo:
    id: int
    username: str
    display_name: str
    is_active: bool


@dataclass
class CredentialRecord:
    pk: Optional[int]
    user_id: int
    credential_id: str              # base64url
    public_key: bytes
    sign_count: int
    transports: List[str] = field(default_factory=list)
    device_type: str = ''           # 'single_device' | 'multi_device' (multi_device = a synced passkey)
    backed_up: bool = False
    aaguid: str = ''
    label: str = ''
    created: Optional[datetime] = None
    last_used_at: Optional[datetime] = None


@dataclass
class VerifiedRegistration:
    credential_id: bytes
    public_key: bytes
    sign_count: int
    device_type: str
    backed_up: bool
    aaguid: str


@dataclass
class VerifiedAuthentication:
    new_sign_count: int
    device_type: str
    backed_up: bool


# --------------------------------------------------------------------------------------------- interfaces

class WebAuthnAdapter(Protocol):
    def registration_options(self, rp: RelyingParty, user_handle: bytes, user_name: str, display_name: str,
                             exclude_ids: List[bytes], challenge: bytes) -> Dict[str, Any]: ...

    def verify_registration(self, credential: Dict[str, Any], challenge: bytes, rp: RelyingParty) -> VerifiedRegistration: ...

    def authentication_options(self, rp: RelyingParty, challenge: bytes) -> Dict[str, Any]: ...

    def verify_authentication(self, credential: Dict[str, Any], challenge: bytes, rp: RelyingParty,
                              public_key: bytes, sign_count: int) -> VerifiedAuthentication: ...


class ChallengeStore(Protocol):
    def put(self, challenge: StoredChallenge) -> None: ...

    def take(self, challenge_id: str) -> Optional[StoredChallenge]:
        """Return the challenge AND delete it, atomically. Two concurrent calls must never both get it."""


class CredentialStore(Protocol):
    def list_for_user(self, user_id: int) -> List[CredentialRecord]: ...
    def get_by_credential_id(self, credential_id: str) -> Optional[CredentialRecord]: ...
    def add(self, record: CredentialRecord) -> CredentialRecord: ...
    def record_login(self, credential_id: str, sign_count: int, backed_up: bool, when: datetime) -> None: ...


class UserDirectory(Protocol):
    def user_handle(self, user_id: int) -> bytes:
        """The user's random WebAuthn handle; created on first use and then never changed."""

    def user_info(self, user_id: int) -> Optional[UserInfo]: ...


# --------------------------------------------------------------------------------------------- the service

class PasskeyService:
    def __init__(self, rp: RelyingParty, adapter: WebAuthnAdapter, challenges: ChallengeStore,
                 credentials: CredentialStore, users: UserDirectory, now=None, token=None):
        self.rp = rp
        self.adapter = adapter
        self.challenges = challenges
        self.credentials = credentials
        self.users = users
        self._now = now or datetime.utcnow
        self._token = token or (lambda: secrets.token_urlsafe(24))

    # ---- registration (the user is already signed in)

    def begin_registration(self, user_id: int) -> Dict[str, Any]:
        existing = self.credentials.list_for_user(user_id)
        if len(existing) >= MAX_PASSKEYS_PER_USER:
            raise PasskeyError('limit_reached')
        info = self.users.user_info(user_id)
        if info is None or not info.is_active:
            raise PasskeyError('bad_request')
        challenge = secrets.token_bytes(32)
        options = self.adapter.registration_options(
            self.rp, self.users.user_handle(user_id), info.username, info.display_name or info.username,
            [b64url_decode(c.credential_id) for c in existing], challenge)
        challenge_id = self._token()
        self.challenges.put(StoredChallenge(challenge_id, PURPOSE_REGISTER, challenge, user_id, self._now() + CHALLENGE_TTL))
        return {'challenge_id': challenge_id, 'options': options}

    def finish_registration(self, user_id: int, challenge_id: Any, credential: Any, label: Any = None) -> CredentialRecord:
        stored = self._take(challenge_id, PURPOSE_REGISTER)
        if stored.user_id != user_id or not isinstance(credential, dict):
            raise PasskeyError('challenge_invalid' if stored.user_id != user_id else 'bad_request')
        try:
            verified = self.adapter.verify_registration(credential, stored.challenge, self.rp)
        except VerificationFailed:
            raise PasskeyError('passkey_failed')
        credential_id = b64url_encode(verified.credential_id)
        if self.credentials.get_by_credential_id(credential_id) is not None:
            raise PasskeyError('already_registered')
        if len(self.credentials.list_for_user(user_id)) >= MAX_PASSKEYS_PER_USER:
            raise PasskeyError('limit_reached')
        response = credential.get('response') if isinstance(credential.get('response'), dict) else {}
        now = self._now()
        record = CredentialRecord(
            pk=None, user_id=user_id, credential_id=credential_id, public_key=verified.public_key,
            sign_count=verified.sign_count, transports=clean_transports(response.get('transports')),
            device_type=verified.device_type, backed_up=verified.backed_up, aaguid=verified.aaguid,
            label=clean_label(label, 'Passkey added %s' % now.strftime('%d %b %Y')), created=now)
        return self.credentials.add(record)

    # ---- sign in (nobody is signed in; discoverable credentials, so no email is asked for)

    def begin_login(self) -> Dict[str, Any]:
        challenge = secrets.token_bytes(32)
        options = self.adapter.authentication_options(self.rp, challenge)
        challenge_id = self._token()
        self.challenges.put(StoredChallenge(challenge_id, PURPOSE_LOGIN, challenge, None, self._now() + CHALLENGE_TTL))
        return {'challenge_id': challenge_id, 'options': options}

    def finish_login(self, challenge_id: Any, credential: Any) -> int:
        """Returns the id of the user who signed in. Every failure is `passkey_failed` (or `challenge_invalid`)."""
        stored = self._take(challenge_id, PURPOSE_LOGIN)
        if not isinstance(credential, dict) or not isinstance(credential.get('id'), str):
            raise PasskeyError('passkey_failed')
        record = self.credentials.get_by_credential_id(credential['id'])
        if record is None:
            raise PasskeyError('passkey_failed')
        response = credential.get('response') if isinstance(credential.get('response'), dict) else {}
        handle = response.get('userHandle')
        if handle:  # W3C: when the authenticator returns one, it must identify the credential's owner
            try:
                given = b64url_decode(handle)
            except PasskeyError:
                raise PasskeyError('passkey_failed')
            if not secrets.compare_digest(given, self.users.user_handle(record.user_id)):
                raise PasskeyError('passkey_failed')
        user = self.users.user_info(record.user_id)
        if user is None or not user.is_active:
            raise PasskeyError('passkey_failed')
        try:
            verified = self.adapter.verify_authentication(credential, stored.challenge, self.rp, record.public_key, record.sign_count)
        except VerificationFailed:
            raise PasskeyError('passkey_failed')
        if not counter_ok(record.sign_count, verified.new_sign_count):
            raise PasskeyError('passkey_failed')
        self.credentials.record_login(record.credential_id, verified.new_sign_count, verified.backed_up, self._now())
        return record.user_id

    # ---- internals

    def _take(self, challenge_id: Any, purpose: str) -> StoredChallenge:
        if not isinstance(challenge_id, str) or not 8 <= len(challenge_id) <= 64:
            raise PasskeyError('challenge_invalid')
        stored = self.challenges.take(challenge_id)   # deleted here: a challenge can never be tried twice
        if stored is None or stored.purpose != purpose or stored.expires_at <= self._now():
            raise PasskeyError('challenge_invalid')
        return stored
