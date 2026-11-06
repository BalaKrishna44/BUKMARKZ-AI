# Spaced-repetition flashcards

Drop-in kit for the Next.js app (paths are relative to the app root):

    sql/010_flashcards.sql                     tables, RLS, review_card() (SM-2 in SQL), review_days()
    lib/sm2.ts, lib/generate.ts                scheduler + card filtering (pure, tested); Claude call
    app/api/flashcards/{generate,due,review}/route.ts
    app/dashboard/review/page.tsx
    components/flashcards/{ReviewDeck,MakeCards}.tsx

Needs `npm i framer-motion`. Uses `@/lib/server` (admin, requireUser, json), `@/lib/llm` (claudeTool) from knowledge-os and `@/lib/supabase/server` from dash.
Run migrations 001, 004, 009_archive first (card text comes from the archived page or OCR text). Env (optional): FLASHCARD_ITEMS_PER_DAY=30, FLASHCARD_NEW_PER_DAY=10.

**How it works.** `POST /api/flashcards/generate {itemId}` builds the source text (archive > OCR > notes; under 400 chars is refused), asks Claude for up to 8 cards by forced tool use, and keeps a card only if its evidence quote really occurs in the page text. `GET /api/flashcards/due?tz=` returns due reviews, then new cards up to the daily allowance, plus the streak (the user's own calendar day). `POST /api/flashcards/review` runs `review_card()` under a row lock.
Private bookmarks (`ai_status = 'skipped_private'`) are never sent to Claude.

**Tests.** `tsx test/logic.test.ts` (29 checks). `PGHOST=... PGPORT=... PGUSER=... tsx test/parity.ts` replays 4,000+ random review histories through both `lib/sm2.ts` and `review_card()` and requires identical results.
Not run: Claude/real Supabase, the React UI (syntax-checked only).
