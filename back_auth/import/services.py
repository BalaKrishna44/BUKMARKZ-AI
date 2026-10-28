from bookmarks.models import Category, Bookmark
from bookmarks.validators import is_web_url


def validate_import_file(soup, user):
    if user.is_subscribed:
        return True
    return _validate_categories(soup, user)


def _validate_categories(soup, user):
    userCategories = Category.objects.filter(user=user)
    categories = soup.find_all('h3')
    if len(categories) + len(userCategories) > 5:
        return False

    for category in categories:
        bookmarks = category.find_next_sibling("dl").find_all("dt")

        userBookmarks = []
        try:
            categoryObject = Category.objects.get(user=user, title=category.get_text())
            userBookmarks = Bookmark.objects.filter(category=categoryObject)
        except Exception as e:
            pass

        if len(bookmarks) + len(userBookmarks) > 10:
            return False

        for bookmark in bookmarks:
            bookmark.decompose()

    otherLinks = soup.find_all('a')
    if len(otherLinks) > 0 and len(categories) + len(userCategories) >= 5:
        return False

    if len(otherLinks) > 5:
        return False

    return True


def import_from_browser_bookmarks(soup, createdCategories, user):
    categories = soup.find_all('h3')
    for category in categories:
        bookmarks = category.find_next_sibling("dl").find_all("dt")
        categoryObject, created = Category.objects.get_or_create(user=user, title=category.get_text())
        if created:
            createdCategories.append(categoryObject)

        for bookmark in bookmarks:

            url = bookmark.find('a')
            try:
                if not is_web_url(url['href']):
                    bookmark.decompose()
                    continue
                bookmarkObj, created = Bookmark.objects.get_or_create(category=categoryObject, name=url.get_text(),
                                                                      url=url['href'])
                description = bookmark.find('div', {'class': 'description'})
                if description:
                    bookmarkObj.description = description.get_text()
                    bookmarkObj.save()

            except Exception as e:
                print(e)

            bookmark.decompose()


def import_other_bookmarks(soup, createdCategories, user, category_name):
    otherLinks = soup.find_all('a')
    if len(otherLinks) > 0:
        category_obj, created = Category.objects.get_or_create(
            user=user, title=category_name)
        if created:
            createdCategories.append(category_obj)
        for url in otherLinks:
            try:
                if is_web_url(url['href']):
                    Bookmark.objects.get_or_create(category=category_obj, name=url.get_text(), url=url['href'])
            except Exception as e:
                print(e)
            url.decompose()
