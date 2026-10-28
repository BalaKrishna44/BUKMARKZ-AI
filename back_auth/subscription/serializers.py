from rest_framework import serializers
from .models import Withdraw, Subscription, SubscriptionFeature, UserSubscription


class WithdrawSerializer(serializers.ModelSerializer):
    class Meta:
        model = Withdraw
        fields = '__all__'


class UserSubscriptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserSubscription
        fields = '__all__'


class SubscriptionFeatureSerializer(serializers.ModelSerializer):
    class Meta:
        model = SubscriptionFeature
        fields = ('id', 'description')


class SubscriptionSerializer(serializers.ModelSerializer):
    features = serializers.SerializerMethodField('get_subscription_features')

    class Meta:
        model = Subscription
        fields = '__all__'

    def get_subscription_features(self, subscription):
        request = self.context.get('request')
        features = subscription.features.all()
        serializer = SubscriptionFeatureSerializer(instance=features, many=True, context={'request': request})
        return serializer.data
