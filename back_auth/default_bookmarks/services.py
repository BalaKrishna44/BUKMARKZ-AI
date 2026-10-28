from .models import DefaultCategory, DefaultBookmark


def get_all_default_categories():
    return DefaultCategory.objects.all()


def get_all_default_bookmarks():
    return DefaultBookmark.objects.all()


def get_category_object_by_id(pk):
    return DefaultCategory.objects.get(id=pk)


def get_default_bookmarks_by_category(category):
    return DefaultBookmark.objects.filter(category=category)
