from django.urls import path, include
from .views import RegisterAPI, LoginAPI, UserAPI, EmailOTPVIew, CheckAccessOTPView, MagicLinkRequestView, MagicLinkVerifyView, OAuthLoginView
from .passkey_views import (PasskeyDetailView, PasskeyListView, PasskeyLoginOptionsView, PasskeyLoginVerifyView,
                            PasskeyRegisterOptionsView, PasskeyRegisterVerifyView)
from knox import views as knox_views

urlpatterns = [
    # path('api/auth', include('knox.urls')),
    path('api/auth/register/', RegisterAPI.as_view()),
    path('api/auth/login/', LoginAPI.as_view()),
    path('api/auth/user/', UserAPI.as_view()),
    path('api/auth/logout/', knox_views.LogoutView.as_view(), name='knox_logout'),
    path('api/auth/magic-link/', MagicLinkRequestView.as_view(), name='magic_link'),
    path('api/auth/magic-link/verify/', MagicLinkVerifyView.as_view(), name='magic_link_verify'),
    path('api/auth/oauth/<str:provider>/', OAuthLoginView.as_view(), name='oauth_login'),
    path('api/auth/passkeys/', PasskeyListView.as_view(), name='passkey_list'),
    path('api/auth/passkeys/<int:pk>/', PasskeyDetailView.as_view(), name='passkey_detail'),
    path('api/auth/passkeys/register/options/', PasskeyRegisterOptionsView.as_view(), name='passkey_register_options'),
    path('api/auth/passkeys/register/verify/', PasskeyRegisterVerifyView.as_view(), name='passkey_register_verify'),
    path('api/auth/passkeys/login/options/', PasskeyLoginOptionsView.as_view(), name='passkey_login_options'),
    path('api/auth/passkeys/login/verify/', PasskeyLoginVerifyView.as_view(), name='passkey_login_verify'),
    path('api/emailOtp/', EmailOTPVIew.as_view(), name='emailOtp'),
    path('api/check_otp/', CheckAccessOTPView.as_view(), name='checkOtp'),
]
