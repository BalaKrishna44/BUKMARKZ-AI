"""Passkey endpoints. See AUTH_API.md ("Passkeys") for the contract.

    POST   /api/auth/passkeys/register/options/   signed in   -> {challenge_id, options}
    POST   /api/auth/passkeys/register/verify/    signed in   {challenge_id, credential, label?} -> the new passkey
    POST   /api/auth/passkeys/login/options/      public      -> {challenge_id, options}
    POST   /api/auth/passkeys/login/verify/       public      {challenge_id, credential} -> the same session body as every other sign-in
    GET    /api/auth/passkeys/                    signed in   -> the person's passkeys
    PATCH  /api/auth/passkeys/<id>/               signed in   {label}
    DELETE /api/auth/passkeys/<id>/               signed in
"""
import logging

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ImproperlyConfigured
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .auth_core import error_body
from .models import PasskeyCredential
from .passkey_core import PasskeyError, PasskeyService, RelyingParty, clean_label
from .passkey_stores import DbChallengeStore, DbCredentialStore, DbUserDirectory, utcnow
from .passkey_webauthn import PyWebAuthnAdapter
from .views import session_response

log = logging.getLogger(__name__)

# Tests replace this to inject a fake adapter.
service_factory = None


def get_service() -> PasskeyService:
    if service_factory is not None:
        return service_factory()
    rp_id = getattr(settings, 'WEBAUTHN_RP_ID', '')
    origins = list(getattr(settings, 'WEBAUTHN_ORIGINS', []))
    if not rp_id or not origins:
        raise ImproperlyConfigured('Set WEBAUTHN_RP_ID (e.g. "bukmarkz.com") and WEBAUTHN_ORIGINS (e.g. ["https://www.bukmarkz.com"]).')
    rp = RelyingParty(rp_id=rp_id, name=getattr(settings, 'WEBAUTHN_RP_NAME', 'Bukmarkz'), origins=origins,
                      user_verification=getattr(settings, 'WEBAUTHN_USER_VERIFICATION', 'required'))
    return PasskeyService(rp, PyWebAuthnAdapter(), DbChallengeStore(), DbCredentialStore(), DbUserDirectory(), now=utcnow)


def _fail(exc: PasskeyError) -> Response:
    status = 404 if exc.code == 'not_found' else 400
    log.info('passkey request refused: %s', exc.code)    # the code only: never the credential, challenge or any user input
    return Response(error_body(exc.code, exc.detail), status=status)


def _public(row: PasskeyCredential) -> dict:
    return {
        'id': row.pk, 'label': row.label, 'created': row.created, 'last_used_at': row.last_used_at,
        'synced': row.device_type == 'multi_device', 'transports': row.transports or [],
    }


class _Base(APIView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'passkey'


class PasskeyRegisterOptionsView(_Base):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        try:
            return Response(get_service().begin_registration(request.user.pk))
        except PasskeyError as exc:
            return _fail(exc)


class PasskeyRegisterVerifyView(_Base):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        try:
            record = get_service().finish_registration(request.user.pk, data.get('challenge_id'), data.get('credential'), data.get('label'))
        except PasskeyError as exc:
            return _fail(exc)
        return Response(_public(PasskeyCredential.objects.get(pk=record.pk)), status=201)


class PasskeyLoginOptionsView(_Base):
    permission_classes = ()
    authentication_classes = ()    # a stale Authorization header must not break sign-in

    def post(self, request):
        try:
            return Response(get_service().begin_login())
        except PasskeyError as exc:
            return _fail(exc)


class PasskeyLoginVerifyView(_Base):
    permission_classes = ()
    authentication_classes = ()

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        try:
            user_id = get_service().finish_login(data.get('challenge_id'), data.get('credential'))
        except PasskeyError as exc:
            return _fail(exc)
        user = get_user_model().objects.get(pk=user_id)
        return session_response(user, request)


class PasskeyListView(_Base):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response([_public(r) for r in PasskeyCredential.objects.filter(user=request.user)])


class PasskeyDetailView(_Base):
    permission_classes = [permissions.IsAuthenticated]

    def _row(self, request, pk):
        # Filtering by the signed-in user means another person's passkey is a plain 404, never a 403 that confirms it exists.
        return PasskeyCredential.objects.filter(user=request.user, pk=pk).first()

    def patch(self, request, pk):
        row = self._row(request, pk)
        if row is None:
            return _fail(PasskeyError('not_found'))
        data = request.data if isinstance(request.data, dict) else {}
        row.label = clean_label(data.get('label'), row.label)
        row.save(update_fields=['label'])
        return Response(_public(row))

    def delete(self, request, pk):
        row = self._row(request, pk)
        if row is None:
            return _fail(PasskeyError('not_found'))
        row.delete()
        return Response(status=204)
