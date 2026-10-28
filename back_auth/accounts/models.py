from django.db import models
from django.contrib.auth.models import AbstractUser
from django_countries.fields import CountryField
from django.contrib.auth import get_user_model
from django.utils import timezone
from offers.models import Offer


class CustomUser(AbstractUser):
    country = CountryField(blank=True, null=True)
    is_subscribed = models.BooleanField(default=False)
    # True once the person has proven they control the mailbox (magic link, OAuth, or a password reset).
    email_verified = models.BooleanField(default=False)


class MagicLink(models.Model):
    """A single-use sign-in link. Only a SHA-256 hash of the token is stored; the token itself is only in the email."""
    email = models.EmailField(db_index=True)
    name = models.CharField(max_length=150, blank=True)       # used when the link creates the account
    token_hash = models.CharField(max_length=64, unique=True)
    allow_signup = models.BooleanField(default=False)          # True only for links requested from "Create account"
    created = models.DateTimeField(auto_now_add=True)
    expires = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return self.email


class PasskeyUserHandle(models.Model):
    """The random, opaque WebAuthn "user handle" for an account (32 random bytes, base64url).

    WebAuthn forbids putting personal data in it, so it is NOT the email, username or database id. It is created the
    first time someone registers a passkey and never changes: every passkey of one user shares it."""
    user = models.OneToOneField(get_user_model(), on_delete=models.CASCADE, related_name='passkey_handle')
    handle = models.CharField(max_length=64, unique=True)


class PasskeyCredential(models.Model):
    """One passkey (a public key plus metadata). The private key never leaves the person's device or password manager."""
    user = models.ForeignKey(get_user_model(), on_delete=models.CASCADE, related_name='passkeys')
    credential_id = models.CharField(max_length=1400, unique=True)   # base64url; up to 1023 raw bytes
    public_key = models.BinaryField()                                # COSE key bytes
    sign_count = models.PositiveBigIntegerField(default=0)
    transports = models.JSONField(default=list, blank=True)
    device_type = models.CharField(max_length=16, blank=True)        # single_device | multi_device (synced)
    backed_up = models.BooleanField(default=False)
    aaguid = models.CharField(max_length=36, blank=True)
    label = models.CharField(max_length=64)
    created = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created']

    def __str__(self):
        return '%s: %s' % (self.user_id, self.label)


class PasskeyChallenge(models.Model):
    """A one-time challenge for a registration or sign-in ceremony. Deleted when used; expired rows are purged by a command."""
    id = models.CharField(max_length=64, primary_key=True)
    purpose = models.CharField(max_length=16)
    challenge = models.CharField(max_length=64)                      # base64url of 32 random bytes
    user_id = models.IntegerField(null=True, blank=True)
    expires = models.DateTimeField(db_index=True)


class EmailOTP(models.Model):
    """OTP for user when he accesses privacy board"""
    user = models.OneToOneField(get_user_model(), on_delete=models.CASCADE)
    otp = models.CharField(max_length=32)
    validated = models.BooleanField(default=False)
    expires = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return self.user.username

    def is_expired(self):
        expire_date = self.expires
        if expire_date > timezone.now():
            return False
        else:
            return True


class Country(models.Model):
    """Countries from where are or where registered users"""
    country = CountryField()

    def __str__(self):
        return self.country.name

    def get_users(self):
        users = get_user_model().objects.filter(country=self.country)
        return len(users)

    def get_offers(self):
        offers = Offer.objects.filter(country=self.country)
        return len(offers)

    class Meta:
        verbose_name_plural = "Countries"
