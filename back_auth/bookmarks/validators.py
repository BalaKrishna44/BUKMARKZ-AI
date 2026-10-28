from urllib.parse import urlparse

from rest_framework import serializers

ALLOWED_SCHEMES = ('http', 'https')


def is_web_url(value):
    try:
        return urlparse(value).scheme.lower() in ALLOWED_SCHEMES
    except (ValueError, AttributeError):
        return False


def validate_web_url(value):
    """Only http(s) links may be stored (blocks javascript:, data:, ftp:, ...)."""
    if not is_web_url(value):
        raise serializers.ValidationError('Only http(s) URLs are allowed.')
    return value
