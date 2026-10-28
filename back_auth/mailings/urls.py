from django.urls import path

from .views import SendEmailView

urlpatterns = [
    path('api/send-email', SendEmailView.as_view(), name='send_email')
]
