from rest_framework.routers import DefaultRouter
from .views import BookmarkViewset

router = DefaultRouter()
router.include_root_view = False

router.register('api/import', BookmarkViewset, basename='import')


urlpatterns = router.urls
