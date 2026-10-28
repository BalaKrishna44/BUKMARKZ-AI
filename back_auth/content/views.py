from rest_framework import viewsets, permissions

from content.models import Video
from content.serializers import VideoSerializer


class VideoReadOnlyViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = (permissions.AllowAny,)
    serializer_class = VideoSerializer
    queryset = Video.objects.all()
