"""Regression tests for the authorization fixes.

NOTE: written without being able to run Django in the review environment.
Run `python manage.py test bookmarks.test_security` and adjust if needed.
"""
from django.contrib.auth import get_user_model
from knox.models import AuthToken
from rest_framework.test import APITestCase

from bookmarks.models import Bookmark, Category
from referral.models import Referral


def auth(client, user):
    _, token = AuthToken.objects.create(user)
    client.credentials(HTTP_AUTHORIZATION='Token ' + token)


class OwnershipTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.alice = User.objects.create_user('alice', 'a@example.com', 'pw-alice-123')
        self.bob = User.objects.create_user('bob', 'b@example.com', 'pw-bob-123')
        self.cat = Category.objects.create(user=self.alice, title='Alice')
        self.bm = Bookmark.objects.create(category=self.cat, name='x', url='https://example.com')

    def test_other_user_cannot_delete_bookmark(self):
        auth(self.client, self.bob)
        r = self.client.delete('/api/bookmark/%d/' % self.bm.id)
        self.assertEqual(r.status_code, 404)
        self.assertTrue(Bookmark.objects.filter(id=self.bm.id).exists())

    def test_other_user_cannot_edit_bookmark(self):
        auth(self.client, self.bob)
        r = self.client.put('/api/bookmark/%d/' % self.bm.id,
                            {'category': self.cat.id, 'name': 'hacked', 'url': 'https://evil.example'})
        self.assertEqual(r.status_code, 404)

    def test_cannot_add_bookmark_to_someone_elses_category(self):
        auth(self.client, self.bob)
        r = self.client.post('/api/bookmark/', {'category': self.cat.id, 'name': 'spam', 'url': 'https://example.com'})
        self.assertEqual(r.status_code, 400)

    def test_javascript_urls_rejected(self):
        auth(self.client, self.alice)
        r = self.client.post('/api/bookmark/', {'category': self.cat.id, 'name': 'xss', 'url': 'javascript:alert(1)'})
        self.assertEqual(r.status_code, 400)

    def test_import_add_bookmark_rejects_foreign_category(self):
        auth(self.client, self.bob)
        r = self.client.post('/api/import/add_bookmark/', {
            'category': self.cat.id, 'url': 'https://example.com', 'title': 't', 'description': ''})
        self.assertEqual(r.status_code, 400)


class PublicSurfaceTests(APITestCase):
    def test_anonymous_cannot_create_default_category(self):
        r = self.client.post('/api/default_category/', {'title': 'x'})
        self.assertIn(r.status_code, (401, 403, 405))

    def test_anonymous_cannot_use_checkout(self):
        r = self.client.post('/api/checkout/', {})
        self.assertIn(r.status_code, (401, 403))

    def test_wallet_is_not_client_writable(self):
        user = get_user_model().objects.create_user('carol', 'c@example.com', 'pw-carol-123')
        ref = Referral.objects.create(user=user, token='abc', wallet=0)
        auth(self.client, user)
        r = self.client.patch('/api/referral/%d/' % ref.id, {'wallet': 99999})
        self.assertEqual(r.status_code, 405)
        ref.refresh_from_db()
        self.assertEqual(ref.wallet, 0)
