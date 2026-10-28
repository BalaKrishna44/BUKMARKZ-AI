from rest_framework.views import APIView
from rest_framework.response import Response

from django.core.exceptions import ValidationError
from django.core.validators import validate_email

from .services import send_email, get_email_data


class SendEmailView(APIView):
    # login required (default) so this cannot be used as an anonymous mail relay
    throttle_scope = 'invite'

    def post(self, *args, **kwargs):
        data = self.request.data.copy()
        try:
            validate_email(data.get('send_to', ''))
        except ValidationError:
            return Response(data='Invalid email address', status=400)
        # the invite always comes from the logged-in user, not from a client-supplied name
        data['email_from'] = self.request.user.email
        if 'url' not in data:
            return Response(data='Request failed', status=400)

        email_data = get_email_data(data)

        response = send_email(email_data, 'InviteFriends')
        return response
