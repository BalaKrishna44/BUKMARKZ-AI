from .models import Offer


def get_all_offers():
    return Offer.objects.all()


def get_offers_by_country(country):
    return Offer.objects.filter(country=country)
