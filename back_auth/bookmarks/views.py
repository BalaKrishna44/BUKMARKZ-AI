from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Bookmark, Recommendation, HelpUser, Category
from .serializers import (
    CategorySerializer,
    BookmarkSerializer,
    RecommendationSerializer,
    UserRecommendationSerializer,
    HelpUserSerializer,
    AdminDashboardSerializer,
    EmailBookmarkSerializer,
)

from django.contrib.auth import get_user_model
from .classify import classify_soon
from .classify_core import INBOX_CATEGORY_TITLE
from .embeddings import embed_bookmark
from .services import (
    get_new_user_emails,
    add_email_bookmarks_to_dashboard,
)


class BookmarkViewSet(viewsets.ModelViewSet):
    permission_classes = [
        permissions.IsAuthenticated
    ]
    serializer_class = BookmarkSerializer

    def get_queryset(self):
        # Only the logged-in user's bookmarks. Because update/destroy use this
        # queryset, nobody can read, edit or delete someone else's bookmark.
        queryset = Bookmark.objects.filter(category__user=self.request.user)
        tag = (self.request.query_params.get('tag') or '').strip().lower()
        if tag:
            queryset = queryset.filter(tags__contains=[tag])   # GET /api/bookmark/?tag=python
        return queryset

    def perform_create(self, serializer):
        bookmark = serializer.save()
        embed_bookmark(bookmark)
        classify_soon(bookmark)

    @action(detail=True, methods=['post'])
    def accept_suggestion(self, request, pk=None):
        """POST /api/bookmark/<id>/accept_suggestion/ : move the bookmark to the category the AI suggested."""
        bookmark = self.get_object()
        target = None
        if bookmark.suggested_category_id:
            target = Category.objects.filter(
                pk=bookmark.suggested_category_id, user=request.user).exclude(private=True).first()
        elif bookmark.suggested_category_title:
            target = (Category.objects.filter(user=request.user, title=bookmark.suggested_category_title).first()
                      or Category.objects.create(user=request.user, title=bookmark.suggested_category_title,
                                                 color='#2B3FD6'))
        if target is None:
            return Response({'detail': 'There is no suggestion to accept.'}, status=status.HTTP_400_BAD_REQUEST)

        bookmark.category = target
        bookmark.suggested_category = None
        bookmark.suggested_category_title = ''
        bookmark.save(update_fields=['category', 'suggested_category', 'suggested_category_title'])
        return Response(self.get_serializer(bookmark).data)

    @action(detail=True, methods=['post'])
    def dismiss_suggestion(self, request, pk=None):
        """POST /api/bookmark/<id>/dismiss_suggestion/ : forget the suggestion (tags stay)."""
        bookmark = self.get_object()
        bookmark.suggested_category = None
        bookmark.suggested_category_title = ''
        bookmark.save(update_fields=['suggested_category', 'suggested_category_title'])
        return Response(self.get_serializer(bookmark).data)

    def perform_update(self, serializer):
        before = serializer.instance
        changed = any(
            field in serializer.validated_data and serializer.validated_data[field] != getattr(before, field)
            for field in ('name', 'url', 'description', 'category')
        )
        bookmark = serializer.save()
        if changed:
            # the old vector no longer matches; clear it so a failed re-embed can't leave stale results
            bookmark.embedding = None
            bookmark.save(update_fields=['embedding'])
            embed_bookmark(bookmark)


class CategoryViewSet(viewsets.ModelViewSet):
    permission_classes = [
        permissions.IsAuthenticated
    ]
    serializer_class = CategorySerializer

    def get_queryset(self):
        return self.request.user.category.all()

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class RecommendationViewSet(viewsets.ModelViewSet):
    permission_classes = [
        permissions.IsAuthenticated
    ]
    serializer_class = UserRecommendationSerializer

    def get_queryset(self):
        return self.request.user.recommendation.all()

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class HelpUserViewSet(viewsets.ModelViewSet):
    permission_classes = [
        permissions.IsAuthenticated
    ]

    serializer_class = HelpUserSerializer

    def get_queryset(self):
        return self.request.user.helpuser.all()

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class AdminDashboardViewSet(viewsets.ModelViewSet):
    permission_classes = [
        permissions.IsAdminUser
    ]

    serializer_class = AdminDashboardSerializer
    queryset = get_user_model().objects.all()


class AllRecommsViewSet(viewsets.ModelViewSet):
    permission_classes = [
        permissions.IsAdminUser
    ]

    serializer_class = RecommendationSerializer
    queryset = Recommendation.objects.all()


class AllAidsViewSet(viewsets.ModelViewSet):
    permission_classes = [
        permissions.IsAdminUser
    ]
    serializer_class = HelpUserSerializer
    queryset = HelpUser.objects.all()


class EmailBookmarkViewSet(viewsets.ModelViewSet):
    permission_classes = [
        permissions.IsAuthenticated
    ]
    serializer_class = EmailBookmarkSerializer

    def get_queryset(self):
        new_emails = get_new_user_emails(self.request.user)
        add_email_bookmarks_to_dashboard(new_emails, self.request.user)

        return self.request.user.emailbookmark.all()

# class BookmarkViewSet(viewsets.ModelViewSet):
#     serializer_class = BookmarkSerializer
#     queryset = Bookmark.objects.all()
#     permission_classes = [
#         permissions.AllowAny
#     ]


# class BookmarkListView(ListAPIView):
#     queryset = Bookmark.objects.all()
#     serializer_class = BookmarkSerializer


# class BookmarkDetailView(RetrieveAPIView):
#     queryset = Bookmark.objects.all()
#     serializer_class = BookmarkSerializer


# class BookmarkCreateView(CreateAPIView):
#     queryset = Bookmark.objects.all()
#     serializer_class = BookmarkSerializer


# class BookmarkUpdateView(UpdateAPIView):
#     queryset = Bookmark.objects.all()
#     serializer_class = BookmarkSerializer


# class BookmarkDeleteView(DestroyAPIView):
#     queryset = Bookmark.objects.all()
#     serializer_class = BookmarkSerializer
