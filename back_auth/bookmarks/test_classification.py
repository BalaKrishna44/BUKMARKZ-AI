"""Tests for AI auto-tagging, using a fake model (no API key, no cost).

Needs PostgreSQL with pgvector, like the search tests. NOTE: written without being able to run Django in
the review environment; run `python manage.py test bookmarks.test_classification` and adjust if needed.
(The pure rules are covered by bookmarks.test_classify_core, which runs anywhere.)
"""
from io import StringIO
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import override_settings
from knox.models import AuthToken
from rest_framework.test import APITestCase

from bookmarks import classify
from bookmarks.classify import ClassificationError
from bookmarks.classify_core import INBOX_CATEGORY_TITLE
from bookmarks.embeddings import EmbeddingError
from bookmarks.models import Bookmark, Category

ON = dict(CLASSIFIER_ENABLED=True, OPENAI_API_KEY='test', CLASSIFIER_ASYNC=False,
          CLASSIFIER_AUTO_MOVE=False, CLASSIFIER_DAILY_LIMIT_PER_USER=200)


def login(client, user):
    _, token = AuthToken.objects.create(user)
    client.credentials(HTTP_AUTHORIZATION='Token ' + token)


def fake_answer(category_id=None, title=None, confidence=0.9, tags=('python', 'django'), description='A Django guide.'):
    return {'results': [{'ref': 0, 'category_id': category_id, 'new_category_title': title,
                         'tags': list(tags), 'description': description, 'confidence': confidence}]}


@override_settings(**ON)
@mock.patch('bookmarks.embeddings.embed_texts', side_effect=EmbeddingError('off in tests'))
class ClassificationTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user('kri', 'k@example.com', 'pw-kri-12345')
        self.other = User.objects.create_user('other', 'o@example.com', 'pw-other-123')
        self.inbox = Category.objects.create(user=self.user, title=INBOX_CATEGORY_TITLE)
        self.dev = Category.objects.create(user=self.user, title='Dev tools')
        self.secret = Category.objects.create(user=self.user, title='Banking', private=True)
        self.foreign = Category.objects.create(user=self.other, title='Theirs')
        login(self.client, self.user)

    def save_from_extension(self, url='https://example.com/a'):
        return self.client.post('/api/extension/bookmarks/', {'url': url, 'title': 'Django tips'}, format='json')

    # --- saving from the extension ---
    def test_extension_save_gets_tags_and_a_category_suggestion(self, _):
        with mock.patch('bookmarks.classify.call_llm', return_value=fake_answer(self.dev.id)):
            r = self.save_from_extension()
        self.assertEqual(r.status_code, 201)
        bm = Bookmark.objects.get(id=r.data['id'])
        self.assertEqual(bm.tags, ['python', 'django'])
        self.assertEqual(bm.suggested_category_id, self.dev.id)
        self.assertEqual(bm.category_id, self.inbox.id)           # suggested only, not moved
        self.assertIsNotNone(bm.classified_at)

    @override_settings(CLASSIFIER_AUTO_MOVE=True)
    def test_confident_result_is_filed_automatically_when_enabled(self, _):
        with mock.patch('bookmarks.classify.call_llm', return_value=fake_answer(self.dev.id, confidence=0.95)):
            r = self.save_from_extension()
        bm = Bookmark.objects.get(id=r.data['id'])
        self.assertEqual(bm.category_id, self.dev.id)
        self.assertTrue(bm.auto_moved)

    def test_new_category_is_only_suggested(self, _):
        with mock.patch('bookmarks.classify.call_llm', return_value=fake_answer(None, 'Travel', 0.9)):
            r = self.save_from_extension()
        bm = Bookmark.objects.get(id=r.data['id'])
        self.assertEqual(bm.suggested_category_title, 'Travel')
        self.assertFalse(Category.objects.filter(user=self.user, title='Travel').exists())

    def test_model_cannot_pick_someone_elses_or_private_category(self, _):
        for bad_id in (self.foreign.id, self.secret.id):
            with mock.patch('bookmarks.classify.call_llm', return_value=fake_answer(bad_id, confidence=0.99)):
                r = self.save_from_extension('https://example.com/%d' % bad_id)
            bm = Bookmark.objects.get(id=r.data['id'])
            self.assertIsNone(bm.suggested_category_id)
            self.assertEqual(bm.category_id, self.inbox.id)

    def test_private_categories_are_not_offered_to_the_model(self, _):
        with mock.patch('bookmarks.classify.call_llm', return_value=fake_answer(self.dev.id)) as llm:
            self.save_from_extension()
        sent = llm.call_args[0][0]
        self.assertIn('Dev tools', sent)
        self.assertNotIn('Banking', sent)

    def test_private_bookmarks_are_never_sent(self, _):
        bm = Bookmark.objects.create(category=self.secret, name='Bank', url='https://example.com/bank')
        with mock.patch('bookmarks.classify.call_llm') as llm:
            classify.classify_soon(bm)
        llm.assert_not_called()

    def test_saving_still_works_when_the_model_is_down(self, _):
        with mock.patch('bookmarks.classify.call_llm', side_effect=ClassificationError('down')):
            r = self.save_from_extension()
        self.assertEqual(r.status_code, 201)
        self.assertIsNone(Bookmark.objects.get(id=r.data['id']).classified_at)    # retried later by the command

    def test_daily_limit_stops_further_calls(self, _):
        with override_settings(CLASSIFIER_DAILY_LIMIT_PER_USER=0), \
                mock.patch('bookmarks.classify.call_llm') as llm:
            r = self.save_from_extension()
        self.assertEqual(r.status_code, 201)
        llm.assert_not_called()

    def test_disabled_without_switch(self, _):
        with override_settings(CLASSIFIER_ENABLED=False), mock.patch('bookmarks.classify.call_llm') as llm:
            self.save_from_extension()
        llm.assert_not_called()

    # --- the person's own choices win ---
    def test_a_category_chosen_by_the_user_is_never_suggested_away(self, _):
        with mock.patch('bookmarks.classify.call_llm', return_value=fake_answer(self.dev.id)):
            r = self.client.post('/api/bookmark/', {'category': self.dev.id, 'name': 'Mine', 'url': 'https://example.com/m'})
        bm = Bookmark.objects.get(id=r.data['id'])
        self.assertEqual(bm.tags, ['python', 'django'])           # tags still help search
        self.assertIsNone(bm.suggested_category_id)
        self.assertEqual(bm.category_id, self.dev.id)

    def test_existing_description_is_kept(self, _):
        with mock.patch('bookmarks.classify.call_llm', return_value=fake_answer(description='AI wrote this')):
            r = self.client.post('/api/bookmark/', {'category': self.dev.id, 'name': 'Mine',
                                                    'url': 'https://example.com/m', 'description': 'My own note'})
        self.assertEqual(Bookmark.objects.get(id=r.data['id']).description, 'My own note')

    def test_clients_cannot_set_ai_fields(self, _):
        with mock.patch('bookmarks.classify.call_llm', return_value=fake_answer()):
            r = self.client.post('/api/bookmark/', {'category': self.dev.id, 'name': 'X', 'url': 'https://example.com/x',
                                                    'classification_confidence': 1, 'auto_moved': True})
        bm = Bookmark.objects.get(id=r.data['id'])
        self.assertFalse(bm.auto_moved)
        self.assertNotEqual(bm.classification_confidence, 1)

    # --- accepting / dismissing suggestions ---
    def test_accept_suggestion_moves_the_bookmark(self, _):
        bm = Bookmark.objects.create(category=self.inbox, name='B', url='https://example.com/b', suggested_category=self.dev)
        r = self.client.post('/api/bookmark/%d/accept_suggestion/' % bm.id)
        self.assertEqual(r.status_code, 200)
        bm.refresh_from_db()
        self.assertEqual(bm.category_id, self.dev.id)
        self.assertIsNone(bm.suggested_category_id)

    def test_accepting_a_new_category_suggestion_creates_it(self, _):
        bm = Bookmark.objects.create(category=self.inbox, name='B', url='https://example.com/b', suggested_category_title='Travel')
        self.client.post('/api/bookmark/%d/accept_suggestion/' % bm.id)
        bm.refresh_from_db()
        self.assertEqual(bm.category.title, 'Travel')

    def test_accept_without_a_suggestion_is_a_400(self, _):
        bm = Bookmark.objects.create(category=self.inbox, name='B', url='https://example.com/b')
        self.assertEqual(self.client.post('/api/bookmark/%d/accept_suggestion/' % bm.id).status_code, 400)

    def test_cannot_accept_someone_elses_suggestion(self, _):
        bm = Bookmark.objects.create(category=self.foreign, name='B', url='https://example.com/b', suggested_category_title='Hack')
        self.assertEqual(self.client.post('/api/bookmark/%d/accept_suggestion/' % bm.id).status_code, 404)

    def test_dismiss_clears_the_suggestion_but_keeps_tags(self, _):
        bm = Bookmark.objects.create(category=self.inbox, name='B', url='https://example.com/b',
                                     tags=['x1'], suggested_category=self.dev)
        self.client.post('/api/bookmark/%d/dismiss_suggestion/' % bm.id)
        bm.refresh_from_db()
        self.assertIsNone(bm.suggested_category_id)
        self.assertEqual(bm.tags, ['x1'])

    # --- tags in the API ---
    def test_filter_by_tag(self, _):
        Bookmark.objects.create(category=self.dev, name='A', url='https://example.com/1', tags=['python'])
        Bookmark.objects.create(category=self.dev, name='B', url='https://example.com/2', tags=['rust'])
        r = self.client.get('/api/bookmark/?tag=Python')
        self.assertEqual([b['name'] for b in r.data], ['A'])

    def test_hand_edited_tags_are_cleaned(self, _):
        bm = Bookmark.objects.create(category=self.dev, name='A', url='https://example.com/1')
        r = self.client.patch('/api/bookmark/%d/' % bm.id, {'tags': ['#Python', 'website', 'python']}, format='json')
        self.assertEqual(r.data['tags'], ['python'])

    # --- the batch command ---
    def test_command_classifies_the_backlog_in_one_call_per_user(self, _):
        a = Bookmark.objects.create(category=self.inbox, name='A', url='https://example.com/1')
        b = Bookmark.objects.create(category=self.inbox, name='B', url='https://example.com/2')
        answer = {'results': [
            {'ref': 0, 'category_id': self.dev.id, 'new_category_title': None, 'tags': ['aa'], 'description': 'x', 'confidence': 0.9},
            {'ref': 1, 'category_id': None, 'new_category_title': 'Cooking', 'tags': ['bb'], 'description': 'y', 'confidence': 0.8},
        ]}
        with mock.patch('bookmarks.classify.call_llm', return_value=answer) as llm:
            call_command('classify_bookmarks', stdout=StringIO())
        self.assertEqual(llm.call_count, 1)
        a.refresh_from_db(); b.refresh_from_db()
        self.assertEqual(a.suggested_category_id, self.dev.id)
        self.assertEqual(b.suggested_category_title, 'Cooking')
