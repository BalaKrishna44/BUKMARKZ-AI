from django.contrib import admin

from .models import Offer, OfferImage


class ImageInLine(admin.TabularInline):
    model = OfferImage
    extra = 0


class OfferAdmin(admin.ModelAdmin):
    inlines = [
        ImageInLine,
    ]


admin.site.register(Offer, OfferAdmin)