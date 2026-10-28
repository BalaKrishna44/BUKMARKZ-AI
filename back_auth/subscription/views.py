from django.db import transaction
from rest_framework.views import APIView
from referral.models import Referral
from rest_framework.response import Response
from rest_framework.status import HTTP_200_OK, HTTP_400_BAD_REQUEST
from .models import UserSubscription, Subscription
from rest_framework.viewsets import ReadOnlyModelViewSet
from .serializers import SubscriptionSerializer, UserSubscriptionSerializer
from rest_framework import permissions
from .withdraw_services import (
    create_user_withdraw,
    validated_data,
    get_user_referral_profile,
    validate_withdraw,
    get_withdraw_data_from_input,
)

from .checkout_services import (
    get_subscription,
    create_stripe_charge,
    save_payment_charge,
    add_user_to_subscribed,
    update_referral_relation,
    update_user_wallet,
)

from mailings.services import send_email


class WithdrawView(APIView):
    permission_classes = [
        permissions.IsAuthenticated
    ]
    throttle_scope = 'withdraw'

    def post(self, request, *args, **kwargs):
        withdraw_data = get_withdraw_data_from_input(request.data)
        if not withdraw_data:
            return Response(data='invalid payout details', status=HTTP_400_BAD_REQUEST)

        # lock the wallet row so two simultaneous requests cannot spend the same money
        with transaction.atomic():
            referral = Referral.objects.select_for_update().filter(user=request.user).first()
            if not validate_withdraw(referral, withdraw_data['amount']):
                return Response(data='withdrawal not allowed', status=HTTP_400_BAD_REQUEST)

            create_user_withdraw(user=request.user, withdraw_data=withdraw_data)
            update_user_wallet(referral, withdraw_data['amount'])

        email_data = {
            'to_emails': request.user.email,
            'subject': 'Withdraw Request'
        }
        send_email(email_data=email_data, email_type='RequestWithdraw')

        return Response(status=HTTP_200_OK)


class CheckoutAPIView(APIView):
    permission_classes = [
        permissions.IsAuthenticated
    ]

    def post(self, request, *args, **kwargs):
        user = request.user
        data = request.data

        if user.is_subscribed:
            return Response(data='User is already subscribed', status=HTTP_200_OK)

        subscription = get_subscription(data.get('subscription'))
        if subscription is None:
            return Response(data='No subscription found', status=HTTP_400_BAD_REQUEST)

        price = subscription.discount_price or subscription.price
        amount = int(price * 100)  # cents
        charge = create_stripe_charge(data, amount, user.id, subscription.id)
        if not charge:
            return Response(data='Failed to create charge', status=400)

        # create payment object
        save_payment_charge(charge['id'], user, amount)

        # add user to subscribed
        add_user_to_subscribed(user, subscription)

        # update referral relation if there exists
        update_referral_relation(user, subscription)

        return Response(status=HTTP_200_OK)


class SubscriptionDetailsAPIView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, *args, **kwargs):
        user = self.request.user
        try:
            userSub = UserSubscription.objects.get(user=user)
            days_remaining = userSub.expires - userSub.started
            return Response(data=days_remaining, status=200)
        except:
            return Response(data='User not subbed')


class UserSubscriptionAPIView(ReadOnlyModelViewSet):
    permission_classes = [permissions.IsAuthenticated, ]
    serializer_class = UserSubscriptionSerializer

    def get_queryset(self):
        return UserSubscription.objects.filter(user=self.request.user)


class PayFromWalletAPIView(APIView):
    permission_classes = [
        permissions.IsAuthenticated
    ]

    def post(self, request, *args, **kwargs):
        user = request.user

        if user.is_subscribed:
            return Response(data='Already sub', status=HTTP_200_OK)

        subscription = get_subscription(request.data.get('subscription'))
        if subscription is None:
            return Response(data='No subscription found', status=HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            referral = Referral.objects.select_for_update().filter(user=user).first()
            if referral is None or referral.wallet < subscription.price:
                return Response(data='Not enough money', status=HTTP_400_BAD_REQUEST)

            add_user_to_subscribed(user, subscription)
            update_user_wallet(referral, subscription.price)

        return Response(data='success', status=HTTP_200_OK)


class SubscriptionReadOnlyViewSet(ReadOnlyModelViewSet):
    permission_classes = [permissions.AllowAny]
    queryset = Subscription.objects.all()
    serializer_class = SubscriptionSerializer
