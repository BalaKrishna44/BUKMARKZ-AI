import re

from .models import Withdraw
from referral.models import Referral

_EMAIL = re.compile(r'^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$')


def create_user_withdraw(user, withdraw_data):
    return Withdraw.objects.create(user=user, name=withdraw_data['name'], payout_email=withdraw_data['payout_email'], amount=withdraw_data['amount'])


def get_user_referral_profile(user):
    return Referral.objects.filter(user=user).first()


def validate_withdraw(referral, amount):
    # NOTE: the original rule was `wallet < amount AND subs < 3` (i.e. 3+ subs allowed overdrawing); both conditions are required now.
    if referral is None or amount is None or amount <= 0:
        return False
    return not (referral.wallet < amount or referral.subs < 3)


def get_withdraw_data_from_input(input_data):
    """Accepts {name, payout_email, amount}. Anything else in the request (e.g. old clients still sending card fields) is ignored, never stored."""
    try:
        name = str(input_data['name']).strip()[:100]
        email = str(input_data['payout_email']).strip().lower()
        amount = int(input_data['amount'])
    except (KeyError, TypeError, ValueError):
        return None
    if not name or amount <= 0 or len(email) > 254 or not _EMAIL.match(email):
        return None
    return {'name': name, 'payout_email': email, 'amount': amount}
