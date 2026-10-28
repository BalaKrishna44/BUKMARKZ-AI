# AI auto-tagging and smart categories for Bukmarkz

Built on top of the AI-search backend (`backend-ai-search.zip`). A small, cheap model reads each new
bookmark and returns **tags**, a **one-line description** (only if you left it empty) and a **category suggestion**.

## What it does
- **Saved from the extension** -> lands in the "Saved from extension" inbox, instantly. In the background the model
  adds tags and suggests where it belongs. The person taps accept or dismiss.
- **Saved in the React app into a category the person chose** -> only tags (and an empty description) are added.
  The person's own category choice is never second-guessed.
- **Imports and old bookmarks** -> `python manage.py classify_bookmarks` works through the backlog in batches of 20.
- Saving never waits for the AI and never fails because of it. If the model is down, the bookmark stays unclassified
  and the command picks it up later.

## Setup
1. `pip install -r requirements.txt` (adds `anthropic`, only used if you choose Claude).
2. `python manage.py migrate` (migration `0006` adds tags, suggestion fields and `classified_at`).
3. In `.env.prod`:

       CLASSIFIER_ENABLED=1
       CLASSIFIER_PROVIDER=openai          # or: anthropic
       OPENAI_API_KEY=...                  # already set for search
       # ANTHROPIC_API_KEY=...             # if CLASSIFIER_PROVIDER=anthropic
       # CLASSIFIER_MODEL=                 # blank = gpt-4o-mini (openai) / claude-haiku-5-5 (anthropic)

4. Classify what you already have: `python manage.py classify_bookmarks --limit 200`
   (repeat, or add it to cron: `*/10 * * * * python manage.py classify_bookmarks --limit 100`).

## Choosing the model
Default is OpenAI `gpt-4o-mini`, so you keep one provider and one key (search already uses OpenAI). Claude is a
one-line switch: `CLASSIFIER_PROVIDER=anthropic` uses `claude-haiku-5-5`, Anthropic's current small model
(Claude 3.5 Haiku is an older generation). Both are forced to answer in a fixed JSON format, so there is no
free-text parsing. Try both on 50 of your own bookmarks and compare the tags; check current pricing for your volume.

## API additions
| Request | What it does |
|---|---|
| `GET /api/bookmark/` | Each bookmark now has `tags`, `suggested_category`, `suggested_category_title`, `classification_confidence`, `auto_moved` |
| `GET /api/bookmark/?tag=python` | Filter by tag |
| `POST /api/bookmark/<id>/accept_suggestion/` | Move to the suggested category (creates it first if the suggestion was a new title) |
| `POST /api/bookmark/<id>/dismiss_suggestion/` | Forget the suggestion, keep the tags |
| `PATCH /api/bookmark/<id>/` with `{"tags": [...]}` | People can edit tags by hand (cleaned with the same rules) |
| `GET /api/search/` | Results now include `tags` |

## Cost controls
- One call classifies up to 20 bookmarks, so the instructions are paid for once, not 20 times.
- Page text sent to the model is cut to 600 characters, titles to 200; replies are small.
- `CLASSIFIER_DAILY_LIMIT_PER_USER` (default 200) caps bookmarks classified per person per 24 hours.
- `--limit` caps every command run. Nothing runs unless `CLASSIFIER_ENABLED=1`.

## Safety decisions
- **The model only suggests by default.** `CLASSIFIER_AUTO_MOVE=False`. Turn it on later to file very confident
  matches (>= 0.8) automatically; `auto_moved` is stored so the app can show "Filed by AI".
- **New categories are never created silently.** A proposed title is stored as a suggestion until the person accepts it.
- **Everything the model returns is treated as untrusted.** It can only choose one of the person's own public
  category ids; tags and descriptions are cleaned and length-limited; confidence is clamped.
- **Prompt injection:** page titles and text are JSON-encoded data, and the instructions tell the model to ignore
  commands inside them. Even if a malicious page fools the model, the worst outcome is odd tags or a wrong
  suggestion, because the output is validated and cannot move anything the person filed themselves.
- **Private categories are never sent to the model** and never offered as a target.
- **Privacy:** titles, links, notes and short page excerpts of public-category bookmarks go to the chosen provider.
  Update your privacy policy, and consider making this opt-in per account.

## Also fixed
`Category.private` is nullable. The earlier search and backfill code used `filter(private=False)`, which silently
skipped rows where it is NULL. They now use `exclude(private=True)`.

## Tests
- `python -m unittest bookmarks.test_classify_core` runs anywhere (19 tests, no database or API key).
- `python manage.py test bookmarks.test_classification` covers the full flow with a fake model; needs Postgres + pgvector.
  Written without being able to run Django here, so run it before deploying.

## Not built yet
- The React side: tag chips on cards, an "Add to Recipes?" banner with Accept / Dismiss, a tag filter.
- Re-embedding after tagging (adding tags to the search embedding is a small follow-up).
- An undo for automatic filing, needed before you switch `CLASSIFIER_AUTO_MOVE` on.
