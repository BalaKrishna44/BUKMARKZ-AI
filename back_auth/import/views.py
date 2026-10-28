from copy import deepcopy

from rest_framework import viewsets
from rest_framework.response import Response
from rest_framework import status
from .serializers import BookmarkSerializer
from rest_framework.decorators import action
from bs4 import BeautifulSoup
from bookmarks.models import Bookmark, Category
from rest_framework import permissions
from bookmarks.serializers import CategorySerializer
from bookmarks.validators import is_web_url
from .services import (import_from_browser_bookmarks, import_other_bookmarks, validate_import_file)

MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024


class BookmarkViewset(viewsets.ModelViewSet):
    """ View for bookmark parse """
    serializer_class = BookmarkSerializer
    queryset = Bookmark.objects.all()
    http_method_names = ['post']
    permission_classes = [
        permissions.IsAuthenticated
    ]

    @action(methods=['post'], detail=False)
    def importFile(self, request, *args, **kwargs):
        try:
            file_main = request.FILES['file']
            if file_main.size > MAX_IMPORT_FILE_BYTES:
                return Response(data='File too large', status=status.HTTP_400_BAD_REQUEST)
            category_name = request.data['category']
            soup = BeautifulSoup(file_main, 'html5lib')
            createdCategories = []

            if not soup:
                return Response(data='Can not open file', status=status.HTTP_200_OK)

            # validate import file
            soupForValidation = deepcopy(soup)
            validated = validate_import_file(soupForValidation, request.user)
            if not validated:
                return Response(data='Too many bookmarks', status=status.HTTP_200_OK)

            # bookmarks imported from browsers
            import_from_browser_bookmarks(soup, createdCategories, request.user)

            # other bookmarks if remained in file
            import_other_bookmarks(soup, createdCategories, request.user, category_name)

            serializer = CategorySerializer(createdCategories, many=True)

            return Response(data=serializer.data, status=status.HTTP_200_OK)
        except:
            return Response(status=status.HTTP_400_BAD_REQUEST)

    @action(methods=['post'], detail=False)
    def add_bookmark(self, request, *args, **kwargs):
        try:
            category_id = request.data['category']
            url = request.data['url']
            title = request.data['title']
            description = request.data['description']
            if not is_web_url(url):
                return Response(data='Only http(s) URLs are allowed', status=status.HTTP_400_BAD_REQUEST)
            # only the user's own categories
            category_obj = Category.objects.get(id=category_id, user=request.user)

            Bookmark.objects.create(
                category=category_obj, name=title, url=url, description=description)
            return Response(status=status.HTTP_201_CREATED)
        except:
            return Response(status=status.HTTP_400_BAD_REQUEST)
