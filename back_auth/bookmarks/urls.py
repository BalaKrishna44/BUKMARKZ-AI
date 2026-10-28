from rest_framework.routers import DefaultRouter
from django.urls import path

from .ai_views import BookmarkSearchView, ExtensionBookmarkView

from .views import (
    CategoryViewSet,
    BookmarkViewSet,
    RecommendationViewSet,
    HelpUserViewSet,
    AdminDashboardViewSet,
    AllRecommsViewSet,
    AllAidsViewSet,
    EmailBookmarkViewSet,
    # BookmarkListView,
    # BookmarkDetailView,
    # BookmarkCreateView,
    # BookmarkUpdateView,
    # BookmarkDeleteView
)

# urlpatterns = [
#     path('', BookmarkViewSet.as_view()),
#
#     path('', BookmarkListView.as_view()),
#     path('add/', BookmarkCreateView.as_view()),
#     path('<pk>/', BookmarkDetailView.as_view()),
#     path('<pk>/update/', BookmarkUpdateView.as_view()),
#     path('<pk>/delete/', BookmarkDeleteView.as_view()),
# ]


router = DefaultRouter()

router.include_root_view = False

router.register('api/category', CategoryViewSet, basename='Category')
router.register('api/bookmark', BookmarkViewSet, basename='Bookmark')
router.register('api/recommendation', RecommendationViewSet, basename='Recommendation')
router.register('api/help_user', HelpUserViewSet, basename='help_user')
router.register('api/admin_dashboard', AdminDashboardViewSet, basename='admin_dashboard')
router.register('api/admin_dashboard_recomms', AllRecommsViewSet, basename='all_recomms')
router.register('api/admin_dashboard_aids', AllAidsViewSet, basename='all_aids')
router.register('api/email_bookmarks', EmailBookmarkViewSet, basename="email_bookmark")


urlpatterns = router.urls + [
    path('api/search/', BookmarkSearchView.as_view(), name='bookmark_search'),
    path('api/extension/bookmarks/', ExtensionBookmarkView.as_view(), name='extension_bookmark'),
]


