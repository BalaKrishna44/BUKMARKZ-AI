from django_rest_passwordreset.signals import reset_password_token_created
from django.template.loader import render_to_string
from django.dispatch import receiver
from django.core.mail import EmailMultiAlternatives
from rest_framework import permissions, generics
from rest_framework.response import Response
from knox.models import AuthToken
from .serializers import UserSerializer, RegisterSerializer, LoginSerializer, INVALID_CREDENTIALS
from rest_framework.views import APIView
from rest_framework.throttling import ScopedRateThrottle
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.utils import timezone
from django_rest_passwordreset.signals import post_password_reset
from django_rest_passwordreset.views import ResetPasswordConfirm, ResetPasswordRequestToken
from datetime import timedelta
import logging
import requests
from mailings.services import send_email

from .auth_core import error_body, first_messages, hash_token, is_expired, magic_link_url, new_magic_token, normalize_email
from .models import MagicLink
from .oauth_core import OAuthError, fetch_profile, redirect_allowed

from .otp_services import (
    create_email_otp,
    get_user_email_otp,
    validate_otp,
    check_otp_state,
    get_email_otp_data,
    check_otp_existence
)

from .user_services import (
    check_user_subscription_validation,
    sign_in_verified_email,
)

logger = logging.getLogger(__name__)


def session_response(user, request, created=False, status=200):
    """The same body for every way of signing in: password, magic link, OAuth."""
    instance, token = AuthToken.objects.create(user)
    return Response({
        'user': UserSerializer(user, context={'request': request}).data,
        'token': token,
        'expiry': instance.expiry,
        'created': created,
    }, status=status)


def _has_code(errors, code):
    return any(getattr(e, 'code', None) == code for e in errors)


# Register API
class RegisterAPI(generics.GenericAPIView):
    serializer_class = RegisterSerializer
    permission_classes = ()
    authentication_classes = ()   # a stale Authorization header must not break sign-up
    throttle_scope = 'register'

    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            fields = first_messages(serializer.errors)
            if _has_code(serializer.errors.get('email', []), 'email_taken'):
                return Response(error_body('email_taken', 'An account with this email already exists.', fields), status=400)
            return Response(error_body('validation_error', 'Check the highlighted fields.', fields), status=400)
        user = serializer.save()
        return session_response(user, request, created=True, status=201)


# Login API
class LoginAPI(generics.GenericAPIView):
    serializer_class = LoginSerializer
    permission_classes = ()
    authentication_classes = ()
    throttle_scope = 'login'

    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            errors = serializer.errors
            if _has_code(errors.get('non_field_errors', []), 'invalid_credentials'):
                body = error_body('invalid_credentials', INVALID_CREDENTIALS)
                body['non_field_errors'] = [INVALID_CREDENTIALS]   # what older clients read
                return Response(body, status=400)
            return Response(error_body('validation_error', 'Check the highlighted fields.', first_messages(errors)), status=400)
        return session_response(serializer.validated_data, request)


# Get User API
class UserAPI(generics.RetrieveAPIView):
    permission_classes = [
        permissions.IsAuthenticated,
    ]
    serializer_class = UserSerializer

    def get_object(self):
        check_user_subscription_validation(self.request.user)

        return self.request.user


@receiver(reset_password_token_created)
def password_reset_token_created(sender, instance, reset_password_token, *args, **kwargs):
    """
    Handles password reset tokens
    When a token is created, an e-mail needs to be sent to the user
    :param sender: View Class that sent the signal
    :param instance: View Instance that sent the signal
    :param reset_password_token: Token Model Object
    :param args:
    :param kwargs:
    :return:
    """

    context = {
        'current_user': reset_password_token.user,
        'username': reset_password_token.user.username,
        'email': reset_password_token.user.email,
        'reset_password_url': "{}/reset_password/confirm/{}".format(settings.MAIN_URL, reset_password_token.key),
        # 'site_name': site_shortcut_name,
        # 'site_domain': site_url
    }

    # render email text
    email_html_message = render_to_string(
        'accounts/user_reset_password.html', context)
    email_plaintext_message = render_to_string(
        'accounts/user_reset_password.txt', context)

    msg = EmailMultiAlternatives(
        # title:
        "Password Reset for {title}".format(title="bukmarkz"),
        # message:
        email_plaintext_message,
        # from:
        "noreply@bukmarkz.com",
        # to:
        [reset_password_token.user.email]
    )
    msg.attach_alternative(email_html_message, "text/html")
    msg.send()


class EmailOTPVIew(APIView):
    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = 'otp'

    def get(self, *args, **kwargs):
        user = self.request.user

        # check if there already exists an OTP for request.user
        check_otp_existence(user)

        # create otp
        emailOTP = create_email_otp(user)

        email_data = get_email_otp_data(emailOTP, user)
        send_email(email_data, email_type='getOTP')

        return Response(data='OTP created', status=200)

    def post(self, *args, **kwargs):
        data = self.request.data
        user = self.request.user

        emailOTP = get_user_email_otp(user)
        return validate_otp(emailOTP, data.get('otp'))


class CheckAccessOTPView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, *args, **kwargs):
        user = self.request.user

        try:
            emailOTP = get_user_email_otp(user)

            return check_otp_state(emailOTP)

        except:
            return Response(data='OTP not found', status=400)


# ---------------------------------------------------------------------------------------------
# Magic link
# ---------------------------------------------------------------------------------------------

MAGIC_LINKS_PER_EMAIL_PER_HOUR = 5
MAGIC_LINK_GENERIC = 'If that address can be used, a sign-in link is on its way.'


def _magic_ttl():
    return timedelta(minutes=getattr(settings, 'MAGIC_LINK_TTL_MINUTES', 15))


class MagicLinkRequestView(APIView):
    """POST {email, mode: "signin" | "signup", name?} -> always the same 200 answer.

    The answer never reveals whether an account exists. "signin" only sends a link to an existing account;
    "signup" (the person ticked the terms) may create the account when the link is opened.
    """
    permission_classes = ()
    authentication_classes = ()
    throttle_scope = 'magic'

    def post(self, request):
        email = normalize_email(request.data.get('email'))
        mode = request.data.get('mode', 'signin')
        name = (request.data.get('name') or '').strip()
        try:
            validate_email(email)
        except DjangoValidationError:
            msg = 'Enter a valid email address.'
            return Response(error_body('validation_error', msg, {'email': msg}), status=400)
        if mode not in ('signin', 'signup'):
            return Response(error_body('validation_error', 'Unknown mode.'), status=400)
        if mode == 'signup' and len(name) < 2:
            msg = 'Enter your full name.'
            return Response(error_body('validation_error', msg, {'name': msg}), status=400)

        has_account = get_user_model().objects.filter(email__iexact=email, is_active=True).exists()
        now = timezone.now()
        too_many = MagicLink.objects.filter(email=email, created__gte=now - timedelta(hours=1)).count() >= MAGIC_LINKS_PER_EMAIL_PER_HOUR
        if (mode == 'signin' and not has_account) or too_many:
            return Response({'detail': MAGIC_LINK_GENERIC})

        token, token_hash = new_magic_token()
        with transaction.atomic():
            # only the newest link works
            MagicLink.objects.filter(email=email, used_at__isnull=True).update(used_at=now)
            MagicLink.objects.create(email=email, name=name[:150], token_hash=token_hash, allow_signup=(mode == 'signup'), expires=now + _magic_ttl())

        url = magic_link_url(settings.MAIN_URL or '', token)
        if settings.DEBUG:
            logger.warning('Magic link for %s: %s', email, url)   # handy in development, never logged in production
        send_email({
            'to_emails': [email],
            'subject': 'Your Bukmarkz AI sign-in link',
            'url': url,
            'minutes': int(_magic_ttl().total_seconds() // 60),
        }, email_type='MagicLink')
        return Response({'detail': MAGIC_LINK_GENERIC})


class MagicLinkVerifyView(APIView):
    """POST {token} -> a session. A POST (not a GET) so mail scanners that pre-fetch links cannot use them up."""
    permission_classes = ()
    authentication_classes = ()
    throttle_scope = 'magic'

    def post(self, request):
        token = request.data.get('token')
        invalid = Response(error_body('invalid_token', 'This sign-in link has expired or was already used. Request a new one.'), status=400)
        if not token or not isinstance(token, str):
            return invalid
        now = timezone.now()
        with transaction.atomic():
            link = MagicLink.objects.select_for_update().filter(token_hash=hash_token(token)).first()
            if link is None or link.used_at is not None or is_expired(link.expires, now):
                return invalid
            link.used_at = now
            link.save(update_fields=['used_at'])
            user, created = sign_in_verified_email(link.email, link.name, allow_create=link.allow_signup)
            if user is None:
                return invalid
        return session_response(user, request, created=created)


# ---------------------------------------------------------------------------------------------
# OAuth (authorization-code flow; the browser sends us the code, the secret never leaves the server)
# ---------------------------------------------------------------------------------------------

class OAuthLoginView(APIView):
    """POST /api/auth/oauth/<google|github>/ {code, redirect_uri} -> a session."""
    permission_classes = ()
    authentication_classes = ()
    throttle_scope = 'oauth'

    def post(self, request, provider):
        code = request.data.get('code')
        redirect_uri = request.data.get('redirect_uri')
        if provider not in ('google', 'github') or not code or not isinstance(code, str):
            return Response(error_body('oauth_failed', 'The sign-in could not be completed.'), status=400)
        if not redirect_allowed(redirect_uri, getattr(settings, 'OAUTH_ALLOWED_REDIRECTS', [])):
            return Response(error_body('oauth_failed', 'The sign-in could not be completed.'), status=400)
        creds = getattr(settings, 'OAUTH_PROVIDERS', {}).get(provider, {})
        try:
            profile = fetch_profile(provider, code, redirect_uri, client_id=creds.get('client_id'), client_secret=creds.get('client_secret'), http=requests)
        except OAuthError as exc:
            return Response(error_body(exc.code, exc.message), status=400)
        user, created = sign_in_verified_email(profile.email, profile.name, allow_create=True)
        if user is None:
            return Response(error_body('oauth_failed', 'This account is disabled.'), status=400)
        return session_response(user, request, created=created)


# ---------------------------------------------------------------------------------------------
# Password reset: the library's views, with rate limits (it ships none) and a verified-email hook
# ---------------------------------------------------------------------------------------------

class ThrottledResetRequest(ResetPasswordRequestToken):
    authentication_classes = ()
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'reset'


class ThrottledResetConfirm(ResetPasswordConfirm):
    authentication_classes = ()
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'reset'


@receiver(post_password_reset)
def on_password_reset(sender, user, *args, **kwargs):
    """Resetting by email proves the mailbox: mark it verified and sign out every old session."""
    user.email_verified = True
    user.save(update_fields=['email_verified'])
    AuthToken.objects.filter(user=user).delete()
