from rest_framework import serializers

from .models import Category, Bookmark, Recommendation, HelpUser, EmailBookmark
from django.contrib.auth import get_user_model
from django_countries.serializers import CountryFieldMixin
from .classify_core import clean_tags
from .validators import validate_web_url


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = '__all__'
        read_only_fields = ('user',)  # always the logged-in user (set in the view)


class BookmarkSerializer(serializers.ModelSerializer):
    class Meta:
        model = Bookmark
        # keep the 1536-number embedding out of every normal API response
        exclude = ('embedding', 'embedding_model', 'embedded_at')
        # set by the AI, never by the client
        read_only_fields = ('suggested_category', 'suggested_category_title',
                            'classification_confidence', 'classified_at', 'auto_moved')

    def validate_url(self, value):
        return validate_web_url(value)

    def validate_tags(self, value):
        # people can edit tags by hand; same cleaning rules as the AI's
        return clean_tags(value)

    def validate_category(self, category):
        # a user may only put bookmarks into their own categories
        request = self.context.get('request')
        if request is None or category.user_id != request.user.id:
            raise serializers.ValidationError('Invalid category.')
        return category


class RecommendationSerializer(serializers.ModelSerializer):
    """Admin serializer: the admin chooses which user receives the recommendation."""

    class Meta:
        model = Recommendation
        fields = '__all__'

    def validate_url(self, value):
        return validate_web_url(value)


class UserRecommendationSerializer(serializers.ModelSerializer):
    """Used for a user's own recommendations: the owner can never be changed."""

    class Meta:
        model = Recommendation
        fields = '__all__'
        read_only_fields = ('user',)

    def validate_url(self, value):
        return validate_web_url(value)


class HelpUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = HelpUser
        fields = '__all__'
        read_only_fields = ('user', 'checked')


class AdminDashboardSerializer(CountryFieldMixin, serializers.ModelSerializer):
    class Meta:
        model = get_user_model()
        # never expose password hashes, permissions or tokens
        exclude = ('password', 'groups', 'user_permissions')


class EmailBookmarkSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmailBookmark
        fields = '__all__'
        read_only_fields = ('user',)
