import datetime

from django.contrib.auth import get_user_model
from django.db import transaction
from knox.models import AuthToken

from referral.models import RefRelation, Referral
from subscription.models import Subscription, UserSubscription

from .auth_core import normalize_email, pick_username, split_name
from .models import Country
from .utils import generate_ref_token


def check_user_subscription_validation(user):
    try:
        userSub = UserSubscription.objects.get(user=user)
        if userSub.is_expired:
            userSub.user.is_subscribed = False
            userSub.user.save()
            userSub.delete()
        else:
            userSub.user.is_subscribed = True
            userSub.user.save()
    except UserSubscription.DoesNotExist:
        pass


def create_user_account(*, email, name='', password=None, username=None, country=None, ref_token='', email_verified=False):
    """The one place accounts are created (password sign-up, magic link and OAuth all use it).

    password=None creates an account that can only sign in by magic link or OAuth.
    """
    User = get_user_model()
    email = normalize_email(email)
    first, last = split_name(name)
    username = username or pick_username(email, lambda u: User.objects.filter(username__iexact=u).exists())
    extra = {'country': country} if country else {}

    with transaction.atomic():
        if country:
            Country.objects.get_or_create(country=country)
        user = User.objects.create_user(
            username, email, password, first_name=first, last_name=last, email_verified=email_verified, **extra)

        # free trial for new accounts
        try:
            subscription = Subscription.objects.get(name='Premium')
            UserSubscription.objects.create(
                user=user, subscription=subscription, trial=True,
                expires=datetime.date.today() + datetime.timedelta(days=subscription.trial_period))
            user.is_subscribed = True
            user.save()
        except Subscription.DoesNotExist:
            pass

        Referral.objects.create(user=user, token=generate_ref_token())

        if ref_token:
            referral = Referral.objects.filter(token=ref_token).first()
            if referral:
                referral.registrations += 1
                referral.save()
                RefRelation.objects.create(referrer=referral.user, user=user)
    return user


def claim_account(user):
    """The caller just proved control of user's mailbox.

    Sign-ups by password do not verify the email, so someone could have registered a victim's address in advance and
    kept the password. If this account was never verified, drop its password and every session, and mark it verified.
    The real owner can set a new password through "Forgot password".
    """
    if user.email_verified:
        return
    if user.has_usable_password():
        user.set_unusable_password()
    user.email_verified = True
    user.save(update_fields=['password', 'email_verified'])
    AuthToken.objects.filter(user=user).delete()


def sign_in_verified_email(email, name='', allow_create=True):
    """For flows that prove mailbox ownership (magic link, OAuth). Returns (user, created); (None, False) if not allowed."""
    User = get_user_model()
    email = normalize_email(email)
    with transaction.atomic():
        user = User.objects.select_for_update().filter(email__iexact=email).order_by('id').first()
        if user is None:
            if not allow_create:
                return None, False
            return create_user_account(email=email, name=name, password=None, email_verified=True), True
        if not user.is_active:
            return None, False
        claim_account(user)
        return user, False
