# AI semantic search for Bukmarkz (pgvector + OpenAI)

Built on top of the hardened backend (`backend-fixed.zip`). New/changed files:

| File | What it does |
|---|---|
| `bookmarks/models.py` | `Bookmark` gains `embedding` (1536-dim `VectorField`), `embedding_model`, `embedded_at`, plus an HNSW cosine index |
| `bookmarks/migrations/0005_bookmark_embedding.py` | Enables the `vector` extension, then adds the columns and index |
| `bookmarks/embeddings.py` | The only code that talks to OpenAI (timeouts, retries, error handling) |
| `bookmarks/ai_views.py` | `GET /api/search/?q=` and `POST /api/extension/bookmarks/` |
| `bookmarks/ai_serializers.py` | Search results and extension input (trims long titles, validates URLs and categories) |
| `bookmarks/management/commands/backfill_embeddings.py` | Embeds existing bookmarks and any that failed earlier |
| `bookmarks/views.py`, `serializers.py`, `urls.py`, `bukmarkz/settings.py`, `requirements.txt` | Wiring: React-app saves also embed; the vector is hidden from normal API responses |

## Setup

1. **Use a Postgres that has pgvector.** The compose files use `postgres:12`, which does not
   include it, and current pgvector releases target newer Postgres versions (check the pgvector
   README for the supported range). Switch to an image such as `pgvector/pgvector:pg16`.
   A major-version change cannot reuse the old data volume: dump the database first
   (`pg_dump`) and restore into the new one.
2. `pip install -r requirements.txt` (adds `pgvector` and `openai`). The current pgvector Python
   package expects a supported Django release; Django 3.1 is end-of-life, so plan the upgrade.
3. Add `OPENAI_API_KEY=...` to `.env.prod` (never commit it).
4. `python manage.py migrate`
   (the DB role must be allowed to run `CREATE EXTENSION`; on managed Postgres, enable "vector" in the dashboard first)
5. `python manage.py backfill_embeddings` to embed your existing bookmarks.

## Using it

Search (logged-in user, Knox token):

    GET /api/search/?q=cheap vegetarian dinner
    -> {"mode": "semantic", "results": [{"id":1,"name":"...","url":"...","similarity":0.83, ...}]}

If OpenAI is unreachable it returns `"mode": "keyword"` using plain text matching instead of failing.

Browser extension:

    POST /api/extension/bookmarks/
    Authorization: Token <token from /api/auth/login/>
    {"url": "https://...", "title": "...", "description": "...", "context": "optional page text", "category": null}
    -> 201 {"id": 7, "created": true, "embedded": true, ...}

Saving the same URL again returns the existing bookmark (200). `context` (e.g. the page's meta
description) improves search quality and is not stored.

## Decisions worth knowing

- **Owner:** your model links bookmarks to users through `category.user`, so that is kept. Every query filters on it.
- **Private categories** are never searched and never sent to OpenAI.
- **Failure-tolerant:** a bookmark is always saved, even if embedding fails; the backfill command catches up.
- **Privacy:** titles, notes and URLs of public-category bookmarks are sent to OpenAI. Mention this in your privacy policy.
- **Quality:** the 70-character `description` limit gives the model little to work with. Consider widening it to a `TextField`.
- **Scale:** embedding runs inside the request (about a second at worst, with a 10 s timeout). When traffic grows, move it to a background worker (Celery/RQ).
- **Cost:** `text-embedding-3-small` is inexpensive, but check current OpenAI pricing for your volume.
- **Tests:** `bookmarks/test_ai_search.py` mocks OpenAI and needs Postgres+pgvector. Not run here; run before deploying.
