from .views import ContactView

from django.urls import path

urlpatterns = [
    path('api/contact/', ContactView.as_view(), name='contact')
]
