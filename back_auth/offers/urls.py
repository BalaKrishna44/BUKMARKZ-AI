from rest_framework.routers import DefaultRouter

from .views import OfferViewSet, AllOffers

router = DefaultRouter()

router.include_root_view = False

router.register('api/offer', OfferViewSet, basename='offer')
router.register('api/all_offers', AllOffers, basename='all_offers')

urlpatterns = router.urls
