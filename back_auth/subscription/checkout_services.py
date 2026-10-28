import logging

import stripe
from django.conf import settings
from rest_framework.response import Response
from .models import Subscription, Payment, UserSubscription
import datetime
from referral.models import RefRelation, Referral

stripe.api_key = settings.STRIPE_SECRET_KEY


logger = logging.getLogger(__name__)


def create_stripe_charge(data, amount, user_id=None, subscription_id=None):
    """Returns the charge, or None. Does not swallow programming errors (the old bare `except:` hid them).
    The idempotency key makes a double click or a client retry return the SAME charge instead of charging twice."""
    token = data.get('stripeToken') if hasattr(data, 'get') else None
    if not isinstance(token, str) or not token.startswith('tok_'):
        return None
    try:
        return stripe.Charge.create(
            amount=amount,  # cents
            currency="usd",
            source=token,
            metadata={'user_id': str(user_id), 'subscription_id': str(subscription_id)},
            idempotency_key=f'charge:{user_id}:{subscription_id}:{token}',
        )
    except stripe.error.StripeError as exc:
        logger.warning('stripe charge failed: %s', type(exc).__name__)     # never log the message: it can echo card data
        return None


def save_payment_charge(charge_id, user, amount):
    payment = Payment.objects.create(
        stripe_charge_id=charge_id,
        user=user,
        amount=amount / 100
    )


def add_user_to_subscribed(user, subscription):
    try:
        user.is_subscribed = True
        user.save()
        expires = datetime.date.today() + datetime.timedelta(days=366)
        userSubscription = _create_user_subscription_object(user, subscription, expires)
    except:
        return Response(data='Can not add user to subscribed', status=400)


def update_referral_relation(user, subscription):
    try:
        refRelation = RefRelation.objects.get(user=user)
        # was Referral.objects.get(referrer=...) -> FieldError swallowed by `except`,
        # so referrers were never credited
        referrer = Referral.objects.get(user=refRelation.referrer)
        referrer.subs += 1
        referrer.wallet += int(subscription.price // 2)
        referrer.save()
    except (RefRelation.DoesNotExist, Referral.DoesNotExist):
        pass


def get_subscription(name):
    try:
        return Subscription.objects.get(name=name)
    except Subscription.DoesNotExist:
        return None


def update_user_wallet(referral, amount):
    referral.wallet -= int(amount)
    referral.save()


def _create_user_subscription_object(user, subscription, expires):
    return UserSubscription.objects.create(
        user=user,
        subscription=subscription,
        expires=expires
    )
