"""Tests for semantic search and the extension endpoint.

These need PostgreSQL with the pgvector extension (SQLite can't store vectors) and
mock OpenAI, so they cost nothing and need no API key.
NOTE: written without being able to run Django in the review environment; run
`python manage.py test bookmarks.test_ai_search` and adjust if needed.
"""
from unittest import mock

from django.contrib.auth import get_user_model
from knox.models import AuthToken
from rest_framework.test import APITestCase

from bookmarks.embeddings import EMBEDDING_MODEL, EmbeddingError
from bookmarks.models import Bookmark, Category, EMBEDDING_DIMENSIONS


def vec(*head):
    """A 1536-dim vector starting with `head`, zero elsewhere."""
    v = [0.0] * EMBEDDING_DIMENSIONS
    for i, x in enumerate(head):
        v[i] = float(x)
    return v


def login(client, user):
    _, token = AuthToken.objects.create(user)
    client.credentials(HTTP_AUTHORIZATION='Token ' + token)


class SearchTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.alice = User.objects.create_user('alice', 'a@example.com', 'pw-alice-123')
        self.bob = User.objects.create_user('bob', 'b@example.com', 'pw-bob-123')
        self.cat = Category.objects.create(user=self.alice, title='Reading')
        self.private = Category.objects.create(user=self.alice, title='Secret', private=True)
        self.near = Bookmark.objects.create(category=self.cat, name='Pasta recipes', url='https://example.com/pasta', embedding=vec(1, 0))
        self.far = Bookmark.objects.create(category=self.cat, name='Tax law', url='https://example.com/tax', embedding=vec(0, 1))
        self.hidden = Bookmark.objects.create(category=self.private, name='Hidden', url='https://example.com/h', embedding=vec(1, 0))
        bob_cat = Category.objects.create(user=self.bob, title='Bob')
        Bookmark.objects.create(category=bob_cat, name='Bob pasta', url='https://example.com/bob', embedding=vec(1, 0))

    def test_requires_login(self):
        self.assertIn(self.client.get('/api/search/?q=pasta').status_code, (401, 403))

    def test_requires_query(self):
        login(self.client, self.alice)
        self.assertEqual(self.client.get('/api/search/').status_code, 400)

    @mock.patch('bookmarks.ai_views.embed_query', return_value=vec(1, 0))
    def test_ranks_by_similarity_and_only_returns_own_public_bookmarks(self, _):
        login(self.client, self.alice)
        r = self.client.get('/api/search/?q=dinner ideas')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['mode'], 'semantic')
        names = [x['name'] for x in r.data['results']]
        self.assertEqual(names, ['Pasta recipes', 'Tax law'])  # not Bob's, not the private one
        self.assertNotIn('embedding', r.data['results'][0])

    @mock.patch('bookmarks.ai_views.embed_query', side_effect=EmbeddingError('down'))
    def test_falls_back_to_keyword_search(self, _):
        login(self.client, self.alice)
        r = self.client.get('/api/search/?q=pasta')
        self.assertEqual(r.data['mode'], 'keyword')
        self.assertEqual([x['name'] for x in r.data['results']], ['Pasta recipes'])


class ExtensionTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user('dev', 'd@example.com', 'pw-dev-12345')
        login(self.client, self.user)

    @mock.patch('bookmarks.embeddings.embed_texts', return_value=[vec(1, 0)])
    def test_creates_bookmark_with_embedding_and_default_category(self, _):
        r = self.client.post('/api/extension/bookmarks/', {'url': 'https://example.com/a', 'title': 'A' * 300}, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertTrue(r.data['embedded'])
        bm = Bookmark.objects.get(id=r.data['id'])
        self.assertEqual(len(bm.name), 100)  # trimmed, not rejected
        self.assertEqual(bm.embedding_model, EMBEDDING_MODEL)
        self.assertEqual(bm.category.title, 'Saved from extension')

    @mock.patch('bookmarks.embeddings.embed_texts', side_effect=EmbeddingError('down'))
    def test_still_saves_when_openai_is_down(self, _):
        r = self.client.post('/api/extension/bookmarks/', {'url': 'https://example.com/b', 'title': 'B'}, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertFalse(r.data['embedded'])

    @mock.patch('bookmarks.embeddings.embed_texts', return_value=[vec(1, 0)])
    def test_duplicate_url_returns_existing(self, _):
        self.client.post('/api/extension/bookmarks/', {'url': 'https://example.com/c', 'title': 'C'}, format='json')
        r = self.client.post('/api/extension/bookmarks/', {'url': 'https://example.com/c', 'title': 'C'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.data['created'])
        self.assertEqual(Bookmark.objects.count(), 1)

    def test_rejects_non_http_urls(self):
        r = self.client.post('/api/extension/bookmarks/', {'url': 'javascript:alert(1)', 'title': 'x'}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_cannot_save_into_someone_elses_category(self):
        other = get_user_model().objects.create_user('o', 'o@example.com', 'pw-other-123')
        cat = Category.objects.create(user=other, title='Theirs')
        r = self.client.post('/api/extension/bookmarks/', {'url': 'https://example.com/d', 'category': cat.id}, format='json')
        self.assertEqual(r.status_code, 400)
