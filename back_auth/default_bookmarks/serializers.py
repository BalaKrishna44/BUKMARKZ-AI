from .models import DefaultBookmark, DefaultCategory
from rest_framework.serializers import ModelSerializer


class BookmarkSerializer(ModelSerializer):
    class Meta:
        model = DefaultBookmark
        fields = '__all__'


class CategorySerializer(ModelSerializer):
    class Meta:
        model = DefaultCategory
        fields = '__all__'
