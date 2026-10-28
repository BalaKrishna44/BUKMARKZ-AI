from django.test import TestCase
from django.contrib.auth import get_user_model
from .models import (
    Category,
    Bookmark,
    Recommendation,
    HelpUser,
    EmailBookmark,
)


"""Unit tests on models"""


class DashboardTest(TestCase):

    @classmethod
    def setUpTestData(cls):
        # create a user
        testuser1 = get_user_model().objects.create_user(
            username='testuser1', password='testpass123', email='testuser@email.com', country='MD'
        )
        testuser1.save()

        # create a categpry
        test_category = Category.objects.create(
            user=testuser1, title='Category1', color='#f2f2f2', private='False'
        )
        test_category.save()

        # create a bookmark
        test_bookmark = Bookmark.objects.create(
            category=test_category, name='Bookmark1', url='https://www.google.com', description='some text here'
        )
        test_bookmark.save()

        # create a recommendation
        test_recommendation = Recommendation.objects.create(
            user=testuser1, title='Recommendation1', url='https://www.google.com', description='text here'
        )
        test_recommendation.save()

        # create help user
        test_help_user = HelpUser.objects.create(
            user=testuser1, country='MD', zip='123', searching='searching something', price='666', checked='True'
        )

        # create email bookmark
        email_bookmark = EmailBookmark.objects.create(
            user=testuser1, title='EmailBookmark1', url='https://www.google.com', description='text here'
        )

    def test_category(self):
        category = Category.objects.get(id=1)
        user = f'{category.user}'
        title = f'{category.title}'
        color = f'{category.color}'
        private = f'{category.private}'

        self.assertEqual(user, 'testuser1')
        self.assertEqual(title, 'Category1')
        self.assertEqual(color, '#f2f2f2')
        self.assertEqual(private, 'False')

    def test_bookmark(self):
        bookmark = Bookmark.objects.get(id=1)
        category = f'{bookmark.category}'
        name = f'{bookmark.name}'
        url = f'{bookmark.url}'
        description = f'{bookmark.description}'

        self.assertEqual(category, 'Category1')
        self.assertEqual(name, 'Bookmark1')
        self.assertEqual(url, 'https://www.google.com')
        self.assertEqual(description, 'some text here')

    def test_recommendation(self):
        recommendation = Recommendation.objects.get(id=1)
        user = f'{recommendation.user}'
        title = f'{recommendation.title}'
        url = f'{recommendation.url}'
        description = f'{recommendation.description}'

        self.assertEqual(user, 'testuser1')
        self.assertEqual(title, 'Recommendation1')
        self.assertEqual(url, 'https://www.google.com')
        self.assertEqual(description, 'text here')

    def test_help_user(self):
        help_user = HelpUser.objects.get(id=1)
        user = f'{help_user.user}'
        country = f'{help_user.country}'
        zip = f'{help_user.zip}'
        searching = f'{help_user.searching}'
        price = f'{help_user.price}'
        checked = f'{help_user.checked}'

        self.assertEqual(user, 'testuser1')
        self.assertEqual(country, 'MD')
        self.assertEqual(zip, '123')
        self.assertEqual(searching, 'searching something')
        self.assertEqual(price, '666.00')
        self.assertEqual(checked, 'True')

    def test_email_bookmarks(self):
        email_bookmark = EmailBookmark.objects.get(id=1)
        user = f'{email_bookmark.user}'
        title = f'{email_bookmark.title}'
        url = f'{email_bookmark.url}'
        description = f'{email_bookmark.description}'

        self.assertEqual(user, 'testuser1')
        self.assertEqual(title, 'EmailBookmark1')
        self.assertEqual(url, 'https://www.google.com')
        self.assertEqual(description, 'text here')


"""API TEST CASES"""


