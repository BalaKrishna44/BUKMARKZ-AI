from django.contrib import admin
from django.urls import path, include, re_path

from django.conf import settings
from django.conf.urls.static import static

# from django.contrib.auth.views import (
#     PasswordResetView,
#     PasswordResetDoneView,
#     PasswordResetConfirmView,
#     PasswordResetCompleteView
# )

from django.views.generic import TemplateView
from django_rest_passwordreset.views import ResetPasswordValidateToken
from accounts.views import ThrottledResetConfirm, ThrottledResetRequest

urlpatterns = [
    # path('rest-auth/',  include('rest_auth.urls')),
    # path('reset-password/', PasswordResetView.as_view(), name='password_reset'),
    # path('reset-password/done/', PasswordResetDoneView.as_view(),
    #      name='password_reset_done'),
    # url(r'^reset-password/confirm/(?P<uidb64>[0-9A-Za-z]+)-(?P<token>.+)/$', PasswordResetConfirmView.as_view(),
    #     name='password_reset_confirm'),
    # path('reset-password/complete/', PasswordResetCompleteView.as_view(),
    #      name='password_reset_complete'),
    # path('api-auth/', include('rest_framework.urls')),
    # path('rest-auth/registration/',  include('rest_auth.registration.urls')),



    # the library's two views with rate limits added; same URLs as before
    path('api/password_reset/confirm/', ThrottledResetConfirm.as_view(), name='reset-password-confirm'),
    path('api/password_reset/validate_token/', ResetPasswordValidateToken.as_view(), name='reset-password-validate'),
    path('api/password_reset/', ThrottledResetRequest.as_view(), name='reset-password-request'),
    path('', include('accounts.urls')),
    path('', include('bookmarks.urls')),
    path('', include('import.urls')),
    path('', include('subscription.urls')),
    path('', include('referral.urls')),
    path('', include('contact.urls')),
    path('', include('default_bookmarks.urls')),
    path('', include('offers.urls')),
    path('', include('mailings.urls')),
    path('', include('content.urls')),
    path('api/admin/', admin.site.urls),

    # re_path('.*', TemplateView.as_view(template_name='index.html')),

]

urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
