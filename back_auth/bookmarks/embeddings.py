"""Thin wrapper around the OpenAI embeddings API.

Everything that talks to OpenAI lives here so it is easy to mock in tests and to swap later.
"""
import logging

from django.conf import settings
from django.utils import timezone
from openai import OpenAI, OpenAIError

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = getattr(settings, 'OPENAI_EMBEDDING_MODEL', 'text-embedding-3-small')
MAX_INPUT_CHARS = 6000  # far below the model's token limit; bookmarks are short anyway

_client = None


class EmbeddingError(Exception):
    """Raised when an embedding could not be generated."""


def _get_client():
    global _client
    if _client is None:
        api_key = getattr(settings, 'OPENAI_API_KEY', None)
        if not api_key:
            raise EmbeddingError('OPENAI_API_KEY is not configured')
        # short timeout + 2 retries so a slow API never hangs a web request
        _client = OpenAI(api_key=api_key, timeout=10.0, max_retries=2)
    return _client


def build_text(name, url, description='', context=''):
    """The text that represents a bookmark in vector space."""
    parts = [name or '', description or '', context or '', url or '']
    return '\n'.join(p.strip() for p in parts if p and p.strip())[:MAX_INPUT_CHARS]


def embed_texts(texts):
    """Embed a list of strings in one API call. Returns a list of 1536-float vectors."""
    texts = [t if t.strip() else ' ' for t in texts]  # the API rejects empty strings
    try:
        response = _get_client().embeddings.create(model=EMBEDDING_MODEL, input=texts)
    except OpenAIError as exc:
        raise EmbeddingError(str(exc)) from exc
    return [item.embedding for item in sorted(response.data, key=lambda d: d.index)]


def embed_query(query):
    return embed_texts([query[:MAX_INPUT_CHARS]])[0]


def embed_bookmark(bookmark, context='', save=True):
    """Generate and store the embedding for one bookmark. Never raises.

    Returns True on success. Bookmarks in private categories are skipped on purpose:
    their titles and links are never sent to a third party.
    """
    if bookmark.category.private:
        return False
    try:
        text = build_text(bookmark.name, bookmark.url, bookmark.description, context)
        bookmark.embedding = embed_texts([text])[0]
    except EmbeddingError:
        logger.warning('Could not embed bookmark %s', bookmark.pk, exc_info=True)
        return False
    bookmark.embedding_model = EMBEDDING_MODEL
    bookmark.embedded_at = timezone.now()
    if save:
        bookmark.save(update_fields=['embedding', 'embedding_model', 'embedded_at'])
    return True
