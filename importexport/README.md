# Bukmarkz import / export / AI enrichment (Next.js App Router + Supabase)

## Install
    npm i @supabase/supabase-js @supabase/ssr server-only
1. Run `sql/001_import_export.sql` in the Supabase SQL editor (idempotent; needs pgvector).
2. Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only),
   `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (embeddings), optional `ENRICH_MODEL` (default claude-haiku-5-5),
   `EMBED_MODEL`, `IMPORT_MAX_ITEMS` (20000), `CRON_SECRET`.
3. Copy `lib/`, `app/api/`, `components/` into the project (`@/` alias). Replace `lib/supabase/server.ts` if you already have one.
4. Add a cron hitting `GET /api/cron/enrich` every 5 min with `Authorization: Bearer $CRON_SECRET`.
5. Render `<ImportExportModal open onClose />`.

## Flow
upload → client preview (same parser) → POST /api/import (SSE: parsed/progress/done) → 500-row RPC batches
→ rows queued `ai_status='pending'` → modal polls POST /api/import/enrich (≈45 s per call) or the cron finishes it.

## Tests
`test/run.ts` (parser/exporter, 10), `test/ai.ts` (worker with mocked APIs). Bundle with esbuild and run with node.

## Auto-organise (300+ messy bookmarks)
Run `sql/002_taxonomy.sql`, then `POST /api/organize` (SSE) or call `new BookmarkOrganizer(new AnthropicLlm(), new SupabaseOrganizerDb(admin)).run(userId)`.
Env: `TAXONOMY_MODEL` (default claude-sonnet-5-5, discovery+merge), `ENRICH_MODEL` (default claude-haiku-5-5, assignment). Test: `test/taxonomy.ts`.
