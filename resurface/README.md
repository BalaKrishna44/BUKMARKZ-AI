# Buk's Morning Resurface

    sql/011_resurface.sql                       columns, tables, RLS, generate_daily_resurface(), resurface_pending_users()
    lib/resurface/{quiz,why}.ts                 recall-question validation + Haiku call; "why this link" text (pure, tested)
    app/api/cron/resurface/route.ts             nightly job (CRON_SECRET)
    app/api/resurface/route.ts                  GET the user's latest batch
    app/api/resurface/action/route.ts           open / archive / restore / quiz result / pause
    components/MorningResurfaceCard.tsx         dark-glass widget with Buk & Markz
    vercel.json.example                         merge into knowledge-os/vercel.json

Needs migrations 001 + 004 (pgvector) first. Uses `@/lib/server` (admin, requireUser, isCron, json) and `@/lib/llm` (claudeTool).
Env: CRON_SECRET, optional RESURFACE_QUIZ_MODEL (default `claude-haiku-5-5`), RESURFACE_USERS_PER_RUN=30, RESURFACE_QUIZZES_PER_RUN=30.
Use: `<MorningResurfaceCard className="mb-6" />` at the top of the dashboard.

**Schedule.** The route handles ~30 users per run, so it runs every 10 minutes from 00:00 to 02:59 UTC. Users who already have a batch drop out of the pending list, so each run takes the next ones and a crashed run is just picked up by the next. For a large user base raise USERS_PER_RUN or run the picker in Postgres with pg_cron (snippet at the bottom of the SQL) and let the route only write quizzes.

**"Archive" means shelved_at.** It hides the link from future Resurface batches. The main dashboard feed does not filter it yet: add `.is('shelved_at', null)` to the query in dash/app/dashboard/page.tsx if you want it hidden there too.

**Privacy.** Bookmarks with `ai_status = 'skipped_private'` are never sent to Claude. Only page text you already stored (archive, OCR, summary/note) is used, and a quiz is kept only if its evidence quote is found in that text.

**Tests.** `tsx test/logic.test.ts` (18). `test/sql_test.sql` (24 checks) on PostgreSQL 16; on a plain Postgres load `test/vector_stub.sql` first (a stand-in for pgvector; Supabase has the real one). Not run: Claude, real pgvector, the React card (syntax-checked only).
