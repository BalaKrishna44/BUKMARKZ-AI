from django.db import models
from django_countries.fields import CountryField


class Offer(models.Model):
    """"Offers by countries"""
    country = CountryField()
    title = models.CharField(max_length=200)
    url = models.URLField(default='')
    discount = models.PositiveIntegerField(blank=True, null=True)
    description = models.CharField(max_length=265, blank=True, null=True)

    def __str__(self):
        return self.title


class OfferImage(models.Model):
    """Image related to an offer"""
    offer = models.ForeignKey(Offer, on_delete=models.CASCADE, related_name='offer_image')
    image = models.ImageField(upload_to='offer_images/')
    # image = models.CharField(max_length=100)
