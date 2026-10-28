from rest_framework import serializers

from .models import Offer, OfferImage


class OfferImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = OfferImage
        fields = ('image',)


class OfferSerializer(serializers.ModelSerializer):
    images = serializers.SerializerMethodField('get_images')

    class Meta:
        model = Offer
        fields = ('country', 'title', 'url', 'description', 'discount', 'images')

    def get_images(self, offer):
        request = self.context.get('request')
        images = OfferImage.objects.filter(offer=offer)
        serializer = OfferImageSerializer(instance=images, many=True, context={'request': request})
        return serializer.data
