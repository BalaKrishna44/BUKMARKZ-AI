from django.db import models
from django.contrib.auth import get_user_model


class Referral(models.Model):
    """Referral profile of every user"""
    user = models.OneToOneField(get_user_model(), on_delete=models.CASCADE, related_name='referrals', default=None)
    token = models.CharField(max_length=50)
    registrations = models.PositiveIntegerField(default=0)
    subs = models.PositiveIntegerField(default=0)
    wallet = models.PositiveIntegerField(default=0)

    def __str__(self):
        return self.user.username


class RefRelation(models.Model):
    """"Referral relations between users (if someone registers ore subs from others referral link)"""
    user = models.OneToOneField(get_user_model(), on_delete=models.CASCADE)
    referrer = models.ForeignKey(get_user_model(), on_delete=models.CASCADE, related_name='referrer')

    def __str__(self):
        return self.user.username
