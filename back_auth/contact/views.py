from rest_framework.views import APIView
from rest_framework.status import HTTP_200_OK, HTTP_400_BAD_REQUEST
from rest_framework.response import Response
from rest_framework.permissions import AllowAny
from django.core.exceptions import ValidationError
from django.core.validators import validate_email

from mailings.services import send_email
from .services import create_contact


class ContactView(APIView):
    permission_classes = [AllowAny]  # public contact form, rate limited
    throttle_scope = 'contact'

    def post(self, *args, **kwargs):
        data = self.request.data
        try:
            validate_email(data.get('email', ''))
        except ValidationError:
            return Response(data='Invalid email address', status=HTTP_400_BAD_REQUEST)
        if not all(data.get(k) for k in ('name', 'subject', 'message')):
            return Response(data='Request failed', status=HTTP_400_BAD_REQUEST)

        contact = create_contact(data)

        """Send email response"""
        email_data = {
            'to_emails': [data['email']],
            'subject': 'Bukmarkz Contact'
        }

        send_email(email_data, email_type='ContactResponse')

        return Response(status=HTTP_200_OK)



