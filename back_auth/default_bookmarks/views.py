from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework import viewsets
from .serializers import CategorySerializer, BookmarkSerializer
from rest_framework import permissions, status
from bookmarks.validators import is_web_url

from .services import (
    get_all_default_categories,
    get_all_default_bookmarks,
    get_category_object_by_id,
    get_default_bookmarks_by_category
)
from bookmarks.services import (
    create_bookmarks_category,
    create_bookmark,
    get_category_by_id
)


class DefaultCategoryView(viewsets.ReadOnlyModelViewSet):
    # Public, read-only. (Previously anyone could POST new default categories.)
    serializer_class = CategorySerializer
    permission_classes = [
        permissions.AllowAny
    ]

    def get_queryset(self):
        return get_all_default_categories()

    @action(detail=False, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def add_to_my_dashboard(self, *args, **kwargs):
        user = self.request.user
        data = self.request.data
        default_category_id = data['default_category']

        default_category = get_category_object_by_id(default_category_id)
        default_bookmarks = get_default_bookmarks_by_category(default_category)

        category = create_bookmarks_category(user=user, title=default_category.title)

        for default_bookmark in default_bookmarks:
            bookmark = create_bookmark(
                category=category,
                name=default_bookmark.name,
                url=default_bookmark.url,
                description=default_bookmark.description
            )

        return Response(data='category added', status=200)


class DefaultBookmarkView(viewsets.ReadOnlyModelViewSet):
    serializer_class = BookmarkSerializer
    permission_classes = [
        permissions.AllowAny
    ]

    def get_queryset(self):
        return get_all_default_bookmarks()

    @action(detail=False, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def add_to_my_category(self, *args, **kwargs):
        user = self.request.user
        data = self.request.data
        category_id = data['category']
        name = data['name']
        url = data['url']
        description = data['description']

        if not is_web_url(url):
            return Response(data='Only http(s) URLs are allowed', status=status.HTTP_400_BAD_REQUEST)

        category = get_category_by_id(pk=category_id)
        if category.user_id != user.id:
            return Response(data='Invalid category', status=status.HTTP_403_FORBIDDEN)

        bookmark = create_bookmark(
            category=category,
            name=name,
            url=url,
            description=description,
        )

        return Response(data='bookmark added', status=200)
