from rest_framework import serializers
from .models import Referral, RefRelation
from django.contrib.auth import get_user_model


class ReferralSerializer(serializers.ModelSerializer):
    class Meta:
        model = Referral
        fields = '__all__'
        read_only_fields = ('user', 'token', 'registrations', 'subs', 'wallet')  # wallet must never be client-writable


class RefRelationSerializer(serializers.ModelSerializer):
    class Meta:
        model = RefRelation
        fields = ('user', 'referrer')










