from rest_framework import serializers
from django.contrib.auth import authenticate
from django.contrib.auth import get_user_model
from django_countries.serializers import CountryFieldMixin
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError

from .auth_core import normalize_email
from .user_services import create_user_account


class UserSerializer(CountryFieldMixin, serializers.ModelSerializer):
    name = serializers.SerializerMethodField()

    class Meta:
        model = get_user_model()
        fields = ('id', 'username', 'email', 'name', 'country', 'is_superuser', 'is_subscribed')

    def get_name(self, user):
        return user.get_full_name().strip() or user.username


INVALID_CREDENTIALS = 'Incorrect email or password. If you usually sign in with a magic link or Google, use that instead.'


class RegisterSerializer(serializers.ModelSerializer):
    """Sign up with a name, an email and a password. (`username` is still accepted for older clients.)"""
    name = serializers.CharField(write_only=True, required=False, allow_blank=True, max_length=150)
    username = serializers.CharField(required=False, allow_blank=True, max_length=150)
    email = serializers.EmailField(max_length=254)
    token = serializers.CharField(max_length=20, default='', required=False, allow_blank=True)  # referral token

    class Meta:
        model = get_user_model()
        fields = ('id', 'name', 'username', 'email', 'password', 'country', 'token')
        extra_kwargs = {'password': {'write_only': True}}

    def validate_email(self, value):
        value = normalize_email(value)
        if get_user_model().objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError('An account with this email already exists.', code='email_taken')
        return value

    def validate_username(self, value):
        if value and get_user_model().objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError('This username is taken.', code='username_taken')
        return value

    def validate(self, attrs):
        name = (attrs.get('name') or '').strip()
        if not attrs.get('username') and len(name) < 2:
            raise serializers.ValidationError({'name': ['Enter your full name.']})
        # Django's password rules (length, common passwords, similarity to the name and email...)
        candidate = get_user_model()(username=attrs.get('username') or '', email=attrs.get('email', ''), first_name=name)
        try:
            validate_password(attrs.get('password'), user=candidate)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({'password': list(exc.messages)})
        return attrs

    def create(self, validated_data):
        return create_user_account(
            email=validated_data['email'],
            name=validated_data.get('name', ''),
            password=validated_data['password'],
            username=validated_data.get('username') or None,
            country=validated_data.get('country') or None,
            ref_token=validated_data.get('token', ''),
        )


class LoginSerializer(serializers.Serializer):
    """Sign in with `email` (or the legacy `username`) and a password. Every failure says the same thing."""
    email = serializers.CharField(required=False, allow_blank=True)
    username = serializers.CharField(required=False, allow_blank=True)
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, data):
        User = get_user_model()
        email = normalize_email(data.get('email'))
        username = (data.get('username') or '').strip()
        if email:
            # emails were not unique in old data: try each matching account
            candidates = list(User.objects.filter(email__iexact=email, is_active=True).order_by('id').values_list('username', flat=True)[:3])
        elif username:
            candidates = [username]
        else:
            raise serializers.ValidationError({'email': ['Enter your email address.']})

        user = None
        for candidate in candidates:
            user = authenticate(username=candidate, password=data['password'])
            if user:
                break
        if not candidates:
            User().set_password(data['password'])  # spend the same time as a real check, so timing doesn't reveal unknown emails
        if user is None or not user.is_active:
            raise serializers.ValidationError(INVALID_CREDENTIALS, code='invalid_credentials')
        return user
