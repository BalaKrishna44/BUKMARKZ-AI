from .models import Contact


def create_contact(data):
    return Contact.objects.create(
        name=data['name'],
        email=data['email'],
        subject=data['subject'],
        message=data['message']
    )
