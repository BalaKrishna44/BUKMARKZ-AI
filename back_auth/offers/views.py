from rest_framework import viewsets, permissions

from .serializers import OfferSerializer
from .services import get_all_offers, get_offers_by_country


class OfferViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [
        permissions.IsAuthenticated
    ]

    serializer_class = OfferSerializer

    def get_queryset(self):
        return get_offers_by_country(country=self.request.user.country)


class AllOffers(viewsets.ReadOnlyModelViewSet):
    # Was AllowAny: this lists every country's partner offers. Signed-in users only.
    permission_classes = [
        permissions.IsAuthenticated
    ]

    serializer_class = OfferSerializer

    def get_queryset(self):
        return get_all_offers()
