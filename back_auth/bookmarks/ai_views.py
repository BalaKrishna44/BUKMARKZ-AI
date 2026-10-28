from django.conf import settings
from django.db.models import Q
from pgvector.django import CosineDistance
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .ai_serializers import ExtensionBookmarkSerializer, SearchResultSerializer
from .classify import classify_soon
from .classify_core import INBOX_CATEGORY_TITLE
from .embeddings import EmbeddingError, embed_bookmark, embed_query
from .models import Bookmark, Category

SEARCH_LIMIT = 10
QUERY_MAX_CHARS = 200
EXTENSION_CATEGORY_TITLE = INBOX_CATEGORY_TITLE
# Optional: hide weak matches. 0.0 = identical, ~1.0 = unrelated. None = always return top 10.
MAX_DISTANCE = getattr(settings, 'BOOKMARK_SEARCH_MAX_DISTANCE', None)


class BookmarkSearchView(APIView):
    """GET /api/search/?q=cheap+vegetarian+dinner  ->  top 10 most relevant bookmarks.

    Only the logged-in user's bookmarks are searched, and private categories are excluded.
    If OpenAI is unavailable the endpoint falls back to plain keyword matching so search
    never just breaks.
    """
    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = 'search'

    def get(self, request):
        q = (request.query_params.get('q') or '').strip()
        if not q:
            return Response({'detail': 'Provide a search query with ?q='}, status=status.HTTP_400_BAD_REQUEST)
        if len(q) > QUERY_MAX_CHARS:
            return Response({'detail': 'Query is too long (max %d characters).' % QUERY_MAX_CHARS},
                            status=status.HTTP_400_BAD_REQUEST)

        # exclude(private=True), not filter(private=False): `private` is nullable and older rows can be NULL
        base = (Bookmark.objects
                .filter(category__user=request.user)
                .exclude(category__private=True)
                .select_related('category'))

        try:
            query_vector = embed_query(q)
        except EmbeddingError:
            return Response({'mode': 'keyword', 'results': self._keyword_search(base, q)})

        queryset = (base.filter(embedding__isnull=False)
                    .annotate(distance=CosineDistance('embedding', query_vector)))
        if MAX_DISTANCE is not None:
            queryset = queryset.filter(distance__lte=MAX_DISTANCE)
        queryset = queryset.order_by('distance')[:SEARCH_LIMIT]

        return Response({
            'mode': 'semantic',
            'results': SearchResultSerializer(queryset, many=True).data,
        })

    @staticmethod
    def _keyword_search(base, q):
        words = q.split()[:6]
        condition = Q()
        for word in words:
            condition &= (Q(name__icontains=word) | Q(url__icontains=word) | Q(description__icontains=word))
        return SearchResultSerializer(base.filter(condition)[:SEARCH_LIMIT], many=True).data


class ExtensionBookmarkView(APIView):
    """POST /api/extension/bookmarks/  (browser extension)

    Headers:  Authorization: Token <knox token from /api/auth/login/>
    Body:     {"url": "...", "title": "...", "description": "...",
               "context": "optional page text for better search", "category": <id, optional>}

    Saves the bookmark and generates its embedding straight away. If OpenAI is down the
    bookmark is still saved (embedded=false) and `manage.py backfill_embeddings` picks it up.
    Saving the same URL twice returns the existing bookmark instead of creating a duplicate.
    """
    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = 'extension'

    def post(self, request):
        serializer = ExtensionBookmarkSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        existing = (Bookmark.objects.select_related('category')
                    .filter(category__user=request.user, url=data['url']).first())
        if existing:
            if existing.embedding is None:
                embed_bookmark(existing, context=data['context'])
            return Response(self._payload(existing, created=False), status=status.HTTP_200_OK)

        category = data['category'] or self._default_category(request.user)
        name = data['title'] or data['url'][:100]
        bookmark = Bookmark.objects.create(
            category=category,
            name=name,
            url=data['url'],
            description=data['description'],
        )
        embed_bookmark(bookmark, context=data['context'])
        classify_soon(bookmark, page_text=data['context'])   # background: tags, description, category suggestion
        return Response(self._payload(bookmark, created=True), status=status.HTTP_201_CREATED)

    @staticmethod
    def _default_category(user):
        category, _ = Category.objects.get_or_create(
            user=user, title=EXTENSION_CATEGORY_TITLE, defaults={'color': '#2B3FD6'})
        return category

    @staticmethod
    def _payload(bookmark, created):
        return {
            'id': bookmark.id,
            'name': bookmark.name,
            'url': bookmark.url,
            'category': bookmark.category_id,
            'created': created,
            'embedded': bookmark.embedding is not None,
        }
