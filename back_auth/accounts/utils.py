from knox.models import AuthToken
import secrets
import string


def create_knox_token(token_model, user, serializer):
    token = AuthToken.objects.create(user=user)
    return token


def generate_ref_token():
    return ''.join(secrets.choice(string.ascii_lowercase + string.digits) for _ in range(12))
