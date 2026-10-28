from rest_framework.routers import DefaultRouter, SimpleRouter
from .views import ReferralView, RefRelationView
from django.urls import path

router = DefaultRouter()
router.include_root_view = False

router.register('api/referral', ReferralView, basename='referral')
router.register('api/refRelation', RefRelationView, basename='refRelation')
urlpatterns = router.urls
