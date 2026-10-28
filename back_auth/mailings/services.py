from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail
from rest_framework.response import Response
from django.conf import settings
from django.template.loader import render_to_string


def send_email(email_data=None, email_type='NoType'):
    html_content = _get_email_template(email_type, email_data)

    message = _create_email_message(email_data, html_content)

    try:
        sg = SendGridAPIClient(settings.SENDGRID_API_KEY)
        response = sg.send(message)
        return Response(data=response, status=200)
    except Exception as e:
        return Response(data=e, status=400)


def get_email_data(data):
    return {
        'to_emails': [data['send_to']],
        'subject': 'Bukmarkz Invites You!',
        'url': data['url'],
        'from_friend': data['email_from'],
    }


def _create_email_message(email_data, html_content):
    message = Mail(
        from_email=settings.EMAIL_ADDRESS,
        to_emails=email_data['to_emails'],
        subject=email_data['subject'],
        html_content=html_content)
    return message


def _get_withdraw_template():
    return render_to_string('emails/withdraw_processing.html')


def _get_invite_friend_template(email_data):
    return render_to_string('emails/invite_friend.html', {
        'url': email_data['url'],
        'from_friend': email_data['from_friend'],
    })


def _get_otp_template(email_data):
    return render_to_string('emails/get_otp.html', {
        'otp': email_data['otp']
    })


def _get_magic_link_template(email_data):
    return render_to_string('emails/magic_link.html', {
        'url': email_data['url'],
        'minutes': email_data['minutes'],
    })


def _get_contact_response_template():
    return render_to_string('emails/response_contact.html')


def _get_email_template(email_type, email_data):
    if email_type == 'InviteFriends':
        return _get_invite_friend_template(email_data)

    if email_type == 'MagicLink':
        return _get_magic_link_template(email_data)

    if email_type == 'getOTP':
        return _get_otp_template(email_data)

    if email_type == 'ContactResponse':
        return _get_contact_response_template()

    if email_type == 'RequestWithdraw':
        return _get_withdraw_template()

    return '<p>Bukmarkz welcomes you!<p>'
