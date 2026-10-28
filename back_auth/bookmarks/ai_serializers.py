from rest_framework import serializers

from .models import Bookmark, Category
from .validators import validate_web_url

NAME_MAX = 100
DESCRIPTION_MAX = 70
URL_MAX = 300


class SearchResultSerializer(serializers.ModelSerializer):
    """A bookmark in search results. Never includes the raw embedding vector."""
    similarity = serializers.SerializerMethodField()
    category_title = serializers.CharField(source='category.title', read_only=True)

    class Meta:
        model = Bookmark
        fields = ('id', 'name', 'url', 'description', 'tags', 'category', 'category_title', 'similarity')

    def get_similarity(self, obj):
        distance = getattr(obj, 'distance', None)
        # cosine distance 0 = identical, 1 = unrelated -> similarity 1..0
        return None if distance is None else round(1 - float(distance), 4)


class ExtensionBookmarkSerializer(serializers.Serializer):
    """Input from the browser extension.

    Long page titles are trimmed instead of rejected, because the extension just
    forwards document.title and the user can't fix it.
    """
    url = serializers.CharField()
    title = serializers.CharField(required=False, allow_blank=True, default='')
    description = serializers.CharField(required=False, allow_blank=True, default='')
    # Optional page text (e.g. the meta description or selected text). Used ONLY to
    # build a better embedding; it is not stored.
    context = serializers.CharField(required=False, allow_blank=True, default='', max_length=2000)
    category = serializers.IntegerField(required=False, allow_null=True, default=None)

    def validate_url(self, value):
        value = value.strip()
        if len(value) > URL_MAX:
            raise serializers.ValidationError('URL is too long (max %d characters).' % URL_MAX)
        return validate_web_url(value)

    def validate_title(self, value):
        return value.strip()[:NAME_MAX]

    def validate_description(self, value):
        return value.strip()[:DESCRIPTION_MAX]

    def validate_category(self, value):
        if value is None:
            return None
        request = self.context['request']
        try:
            return Category.objects.get(pk=value, user=request.user)
        except Category.DoesNotExist:
            raise serializers.ValidationError('Invalid category.')
