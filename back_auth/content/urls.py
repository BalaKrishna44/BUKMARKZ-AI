from rest_framework.routers import DefaultRouter
from .views import VideoReadOnlyViewSet

router = DefaultRouter()

router.include_root_view = False

router.register('api/content/video', VideoReadOnlyViewSet, basename='content_video')

urlpatterns = router.urls
