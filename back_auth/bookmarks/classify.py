"""AI auto-tagging and categorisation (Django side).

Cheap, fast models do this job: OpenAI `gpt-4o-mini` by default, or Anthropic Claude Haiku.
Switch with CLASSIFIER_PROVIDER=openai|anthropic. Pure rules and prompts live in classify_core.py.
"""
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from django.conf import settings
from django.db import close_old_connections, transaction
from django.utils import timezone

from . import classify_core as core
from .models import Bookmark, Category

logger = logging.getLogger(__name__)

DEFAULT_MODELS = {'openai': 'gpt-4o-mini', 'anthropic': 'claude-haiku-5-5'}
TIMEOUT_SECONDS = 20.0
BATCH_SIZE = 20

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix='bookmark-classifier')
_clients = {}


class ClassificationError(Exception):
    """The model could not be reached or returned nothing usable."""


# ---------- settings ----------

def provider():
    return getattr(settings, 'CLASSIFIER_PROVIDER', 'openai').lower()


def model_name():
    return getattr(settings, 'CLASSIFIER_MODEL', '') or DEFAULT_MODELS.get(provider(), DEFAULT_MODELS['openai'])


def is_enabled():
    """Off unless switched on AND the chosen provider has an API key."""
    if not getattr(settings, 'CLASSIFIER_ENABLED', False):
        return False
    key = settings.ANTHROPIC_API_KEY if provider() == 'anthropic' else settings.OPENAI_API_KEY
    return bool(key)


# ---------- model calls ----------

def _client():
    name = provider()
    if name not in _clients:
        if name == 'anthropic':
            import anthropic
            _clients[name] = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY, timeout=TIMEOUT_SECONDS, max_retries=2)
        else:
            from openai import OpenAI
            _clients[name] = OpenAI(api_key=settings.OPENAI_API_KEY, timeout=TIMEOUT_SECONDS, max_retries=2)
    return _clients[name]


def call_llm(user_message):
    """Ask the model to classify. Returns the parsed {"results": [...]} payload.

    Both providers are forced to answer in the schema from classify_core (strict JSON schema on
    OpenAI, a forced tool call on Anthropic), so there is no free-text parsing to go wrong.
    """
    try:
        if provider() == 'anthropic':
            response = _client().messages.create(
                model=model_name(),
                max_tokens=2000,
                system=core.SYSTEM_PROMPT,
                tools=[{
                    'name': 'save_classification',
                    'description': 'Save the classification of every bookmark.',
                    'input_schema': core.RESULT_SCHEMA,
                }],
                tool_choice={'type': 'tool', 'name': 'save_classification'},
                messages=[{'role': 'user', 'content': user_message}],
            )
            for block in response.content:
                if getattr(block, 'type', '') == 'tool_use':
                    return block.input
            raise ClassificationError('model returned no tool call')

        import json
        response = _client().chat.completions.create(
            model=model_name(),
            temperature=0,
            max_tokens=2000,
            messages=[
                {'role': 'system', 'content': core.SYSTEM_PROMPT},
                {'role': 'user', 'content': user_message},
            ],
            response_format={
                'type': 'json_schema',
                'json_schema': {'name': 'bookmark_classification', 'strict': True, 'schema': core.RESULT_SCHEMA},
            },
        )
        return json.loads(response.choices[0].message.content)
    except ClassificationError:
        raise
    except Exception as exc:  # network, rate limit, bad JSON, SDK errors
        raise ClassificationError(str(exc)) from exc


# ---------- guards ----------

def daily_limit_reached(user):
    limit = getattr(settings, 'CLASSIFIER_DAILY_LIMIT_PER_USER', 200)
    since = timezone.now() - timedelta(days=1)
    used = Bookmark.objects.filter(category__user=user, classified_at__gte=since).count()
    return used >= limit


def _public_categories(user):
    return [{'id': c.id, 'title': c.title}
            for c in Category.objects.filter(user=user).exclude(private=True)]


# ---------- applying results ----------

def _apply(bookmark, clean, inbox_ids):
    """Write one cleaned result onto a bookmark (does not touch bookmarks the user filed themselves)."""
    in_inbox = bookmark.category_id in inbox_ids
    outcome = core.decide(
        clean,
        in_inbox=in_inbox,
        auto_move=getattr(settings, 'CLASSIFIER_AUTO_MOVE', False),
        suggest_min=getattr(settings, 'CLASSIFIER_SUGGEST_MIN', 0.5),
        auto_min=getattr(settings, 'CLASSIFIER_AUTO_MOVE_MIN', 0.8),
    )

    # tags always; a description only when the person left it empty
    if clean['tags'] and not bookmark.tags:
        bookmark.tags = clean['tags']
    if clean['description'] and not (bookmark.description or '').strip():
        bookmark.description = clean['description']

    bookmark.suggested_category = None
    bookmark.suggested_category_title = ''
    bookmark.auto_moved = False
    if outcome['move_to']:
        bookmark.category_id = outcome['move_to']
        bookmark.auto_moved = True
    elif outcome['suggest_category']:
        bookmark.suggested_category_id = outcome['suggest_category']
    elif outcome['suggest_title']:
        bookmark.suggested_category_title = outcome['suggest_title']

    bookmark.classification_confidence = clean['confidence']
    bookmark.classified_at = timezone.now()
    bookmark.save(update_fields=[
        'tags', 'description', 'category', 'suggested_category', 'suggested_category_title',
        'classification_confidence', 'classified_at', 'auto_moved'])


def classify_bookmarks(bookmarks, page_text=None):
    """Classify bookmarks that belong to ONE user in a single model call. Returns how many were updated.

    Private-category bookmarks are never sent to the model, and private categories are never offered as targets.
    page_text: optional {bookmark_id: text} (e.g. the page's meta description from the extension).
    """
    bookmarks = [b for b in bookmarks if not b.category.private]
    if not bookmarks:
        return 0
    user = bookmarks[0].category.user
    categories = _public_categories(user)
    inbox_ids = {c['id'] for c in categories if c['title'] == core.INBOX_CATEGORY_TITLE}
    page_text = page_text or {}

    message = core.build_user_message(
        [{'title': b.name, 'url': b.url, 'note': b.description, 'page_text': page_text.get(b.id, '')} for b in bookmarks],
        categories,
    )
    items = core.extract_items(call_llm(message), len(bookmarks))

    updated = 0
    for index, bookmark in enumerate(bookmarks):
        raw = items.get(index)
        if raw is None:
            continue                      # no answer for this one; it stays unclassified and is retried later
        _apply(bookmark, core.sanitize_item(raw, categories), inbox_ids)
        updated += 1
    return updated


# ---------- entry points used by the API ----------

def _run(bookmark_id, page_text):
    close_old_connections()
    try:
        bookmark = Bookmark.objects.select_related('category__user').get(pk=bookmark_id)
        if bookmark.classified_at is None and not daily_limit_reached(bookmark.category.user):
            classify_bookmarks([bookmark], {bookmark_id: page_text} if page_text else None)
    except Exception:
        # never break saving a bookmark; it stays unclassified and `manage.py classify_bookmarks` retries it
        logger.warning('Could not classify bookmark %s', bookmark_id, exc_info=True)
    finally:
        close_old_connections()


def classify_soon(bookmark, page_text=''):
    """Classify one bookmark in the background, after the current request's transaction commits."""
    if not is_enabled() or bookmark.category.private:
        return
    if getattr(settings, 'CLASSIFIER_ASYNC', True):
        transaction.on_commit(lambda: _executor.submit(_run, bookmark.pk, page_text))
    else:
        _run(bookmark.pk, page_text)      # tests and debugging
