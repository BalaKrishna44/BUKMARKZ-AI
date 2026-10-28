from rest_framework.routers import DefaultRouter

from .views import DefaultBookmarkView, DefaultCategoryView

router = DefaultRouter()

router.include_root_view = False

router.register('api/default_bookmark', DefaultBookmarkView, basename='default_bookmark')
router.register('api/default_category', DefaultCategoryView, basename='default_category')

urlpatterns = router.urls
