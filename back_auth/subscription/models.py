from django.db import models
from django.utils import timezone
from django.contrib.auth import get_user_model
from django.utils.translation import gettext_lazy as _


class Payment(models.Model):
    """Model where we store stripe charges"""
    stripe_charge_id = models.CharField(max_length=50)
    user = models.ForeignKey(get_user_model(),
                             on_delete=models.SET_NULL, blank=True, null=True)
    amount = models.DecimalField(max_digits=5, decimal_places=2)
    timestamp = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.stripe_charge_id


class Subscription(models.Model):
    """Type of subscriptions on the website"""

    class SubscriptionType(models.TextChoices):
        BASIC = 'Basic', _('Basic')
        Premium = 'Premium', _('Premium')

    name = models.CharField(max_length=100, choices=SubscriptionType.choices)
    price = models.DecimalField(max_digits=5, decimal_places=2)
    discount_price = models.DecimalField(max_digits=5, decimal_places=2, default=0, blank=True, null=True)
    trial_period = models.PositiveIntegerField(default=0, help_text='(days)')
    max_categories_stored = models.PositiveIntegerField(default=0, help_text='0 means infinity')
    max_bookmarks_in_one_category = models.PositiveIntegerField(default=0, help_text='0 means infinity')

    def __str__(self):
        return self.name


class SubscriptionFeature(models.Model):
    subscription = models.ForeignKey(Subscription, on_delete=models.CASCADE, related_name='features')
    description = models.CharField(max_length=255)

    def __str__(self):
        return self.subscription.name


class UserSubscription(models.Model):
    """Model to store subscription details for user"""
    user = models.OneToOneField(get_user_model(), on_delete=models.CASCADE, related_name='sub')
    subscription = models.ForeignKey(Subscription, on_delete=models.CASCADE)
    started = models.DateField(auto_now_add=True)
    expires = models.DateField(null=True, blank=True)
    trial = models.BooleanField(default=False)

    @property
    def is_expired(self):
        expire_date = self.expires
        if expire_date > timezone.now().date():
            return False
        else:
            return True

    def __str__(self):
        return self.user.username


class Withdraw(models.Model):
    """Model for card details of user who requested a withdrawal from his wallet"""
    user = models.ForeignKey(get_user_model(), on_delete=models.CASCADE)
    card_number = models.DecimalField(max_digits=16, decimal_places=0)
    expiry_date = models.DateField()
    name = models.CharField(max_length=100)
    cvc = models.DecimalField(max_digits=3, decimal_places=0)
    withdrawal_date = models.DateField(auto_now_add=True)
    amount = models.DecimalField(max_digits=6, decimal_places=0, default=0)

    def __str__(self):
        return self.name
