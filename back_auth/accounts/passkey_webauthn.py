"""The only file that imports the `webauthn` package (py_webauthn, https://github.com/duo-labs/py_webauthn).

If a new release of the package changes a name or argument, this is the one place to fix. It was written against the
2.x API and has NOT been run in the environment it was written in (no network to install the package): run
accounts/tests_passkey_api.py and a real browser pass before relying on it. Needs Python 3.9+ and a current `cryptography`.
"""
import json
from typing import Any, Dict, List

from webauthn import (
    generate_authentication_options, generate_registration_options, options_to_json,
    verify_authentication_response, verify_registration_response,
)
from webauthn.helpers.exceptions import InvalidAuthenticationResponse, InvalidRegistrationResponse
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria, PublicKeyCredentialDescriptor, ResidentKeyRequirement, UserVerificationRequirement,
)

from .passkey_core import RelyingParty, VerificationFailed, VerifiedAuthentication, VerifiedRegistration

# Library errors we treat as "this response is not valid". Anything else is a bug and should surface as a 500 in the logs.
_REJECTIONS = (InvalidRegistrationResponse, InvalidAuthenticationResponse, ValueError, KeyError, TypeError)


def _uv(rp: RelyingParty) -> UserVerificationRequirement:
    return UserVerificationRequirement(rp.user_verification)


class PyWebAuthnAdapter:
    def registration_options(self, rp: RelyingParty, user_handle: bytes, user_name: str, display_name: str,
                             exclude_ids: List[bytes], challenge: bytes) -> Dict[str, Any]:
        options = generate_registration_options(
            rp_id=rp.rp_id, rp_name=rp.name, user_id=user_handle, user_name=user_name, user_display_name=display_name,
            challenge=challenge,
            # Discoverable credential required: that is what makes a passkey appear in the browser's account picker.
            authenticator_selection=AuthenticatorSelectionCriteria(resident_key=ResidentKeyRequirement.REQUIRED, user_verification=_uv(rp)),
            exclude_credentials=[PublicKeyCredentialDescriptor(id=i) for i in exclude_ids],
        )   # attestation defaults to "none": we do not need to know the make of the authenticator
        return json.loads(options_to_json(options))

    def verify_registration(self, credential: Dict[str, Any], challenge: bytes, rp: RelyingParty) -> VerifiedRegistration:
        try:
            result = verify_registration_response(
                credential=credential, expected_challenge=challenge, expected_rp_id=rp.rp_id, expected_origin=rp.origins,
                require_user_verification=rp.user_verification == 'required')
        except _REJECTIONS as exc:
            raise VerificationFailed(str(exc))
        return VerifiedRegistration(
            credential_id=result.credential_id, public_key=result.credential_public_key, sign_count=result.sign_count,
            device_type=str(getattr(result.credential_device_type, 'value', result.credential_device_type)),
            backed_up=bool(result.credential_backed_up), aaguid=str(result.aaguid or ''))

    def authentication_options(self, rp: RelyingParty, challenge: bytes) -> Dict[str, Any]:
        # No allowCredentials: the browser offers whichever passkeys it has for this site (the autofill list, or the account picker).
        options = generate_authentication_options(rp_id=rp.rp_id, challenge=challenge, user_verification=_uv(rp))
        return json.loads(options_to_json(options))

    def verify_authentication(self, credential: Dict[str, Any], challenge: bytes, rp: RelyingParty,
                              public_key: bytes, sign_count: int) -> VerifiedAuthentication:
        try:
            result = verify_authentication_response(
                credential=credential, expected_challenge=challenge, expected_rp_id=rp.rp_id, expected_origin=rp.origins,
                credential_public_key=public_key, credential_current_sign_count=sign_count,
                require_user_verification=rp.user_verification == 'required')
        except _REJECTIONS as exc:
            raise VerificationFailed(str(exc))
        return VerifiedAuthentication(
            new_sign_count=result.new_sign_count,
            device_type=str(getattr(result.credential_device_type, 'value', result.credential_device_type)),
            backed_up=bool(result.credential_backed_up))
