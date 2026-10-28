"""Django-backed implementations of the stores that passkey_core.py needs. Thin on purpose: no rules live here."""
import secrets
from typing import List, Optional

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.utils import timezone

from .models import PasskeyChallenge, PasskeyCredential, PasskeyUserHandle
from .passkey_core import CredentialRecord, StoredChallenge, UserInfo, b64url_decode, b64url_encode


class DbChallengeStore:
    def put(self, challenge: StoredChallenge) -> None:
        PasskeyChallenge.objects.create(
            id=challenge.challenge_id, purpose=challenge.purpose, challenge=b64url_encode(challenge.challenge),
            user_id=challenge.user_id, expires=challenge.expires_at)

    def take(self, challenge_id: str) -> Optional[StoredChallenge]:
        """Read and delete in one transaction with a row lock, so two parallel requests cannot both use the same challenge."""
        with transaction.atomic():
            row = PasskeyChallenge.objects.select_for_update().filter(pk=challenge_id).first()
            if row is None:
                return None
            data = StoredChallenge(row.id, row.purpose, b64url_decode(row.challenge), row.user_id, row.expires)
            row.delete()
            return data


def _record(row: PasskeyCredential) -> CredentialRecord:
    return CredentialRecord(
        pk=row.pk, user_id=row.user_id, credential_id=row.credential_id, public_key=bytes(row.public_key),
        sign_count=row.sign_count, transports=list(row.transports or []), device_type=row.device_type,
        backed_up=row.backed_up, aaguid=row.aaguid, label=row.label, created=row.created, last_used_at=row.last_used_at)


class DbCredentialStore:
    def list_for_user(self, user_id: int) -> List[CredentialRecord]:
        return [_record(r) for r in PasskeyCredential.objects.filter(user_id=user_id)]

    def get_by_credential_id(self, credential_id: str) -> Optional[CredentialRecord]:
        row = PasskeyCredential.objects.filter(credential_id=credential_id).first()
        return _record(row) if row else None

    def add(self, record: CredentialRecord) -> CredentialRecord:
        row = PasskeyCredential.objects.create(
            user_id=record.user_id, credential_id=record.credential_id, public_key=record.public_key,
            sign_count=record.sign_count, transports=record.transports, device_type=record.device_type,
            backed_up=record.backed_up, aaguid=record.aaguid, label=record.label)
        return _record(row)

    def record_login(self, credential_id: str, sign_count: int, backed_up: bool, when) -> None:
        PasskeyCredential.objects.filter(credential_id=credential_id).update(sign_count=sign_count, backed_up=backed_up, last_used_at=when)


class DbUserDirectory:
    def user_handle(self, user_id: int) -> bytes:
        row = PasskeyUserHandle.objects.filter(user_id=user_id).first()
        if row is None:
            try:
                with transaction.atomic():
                    row = PasskeyUserHandle.objects.create(user_id=user_id, handle=b64url_encode(secrets.token_bytes(32)))
            except IntegrityError:   # two first registrations at once: keep the one that won
                row = PasskeyUserHandle.objects.get(user_id=user_id)
        return b64url_decode(row.handle)

    def user_info(self, user_id: int) -> Optional[UserInfo]:
        user = get_user_model().objects.filter(pk=user_id).first()
        if user is None:
            return None
        return UserInfo(id=user.pk, username=user.email or user.username, display_name=user.get_full_name() or user.username, is_active=user.is_active)


def utcnow():
    return timezone.now()
