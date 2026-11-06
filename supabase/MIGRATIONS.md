# Database migrations

`supabase/migrations/` is generated from `supabase/migration-order.txt` by `sh scripts/build-migrations.sh`. The kit folders (`importexport/sql`, `dash/sql`, ...) stay the source; this list fixes the order and removes the old number clashes.
Apply with the Supabase CLI: `supabase link --project-ref <ref>` then `supabase db push`.

Order rules: `share_kit/supabase/bookmarks.sql` first (several later files reference `bookmarks`), then ascending number. Same-number files (005, 006, 007, 010) are independent; list order above breaks the tie.

## Deliberately NOT included
- `ai-engine/sql/001_ai_features.sql` and `024_lock_search_index.sql`. They define a *second, different* `oneclist_items` (AI checklist steps, keyed to `bookmarks`) that collides with the vault table from `importexport/sql/001`. Nothing in `app-shell` imports `lib/ai-engine`, so it is a separate worker design. If you want it, give its checklist table another name first (for example `ai_checklist_steps`) and update `lib/ai-engine/src/repo.ts`.
- `photo-backup/` (own Supabase project) and anything under `test/` or `qa-suite/`.

## Before `db push`
- Enable extensions in the Supabase dashboard: `vector`, `pg_cron`, `pg_net`.
- The `*b_*_cron.sql` files read Vault secrets `project_url` and `digest_cron_secret`. Create them first (see `growth-kit` and `link-health` READMEs) or those three files will schedule jobs that fail.
- Storage buckets are created by 009 and 031. Nothing to do.

## Check locally
`su postgres -c "sh scripts/verify-migrations.sh supabase/migration-order.txt"` applies the list to a throw-away PG16 with stubs for pgvector/cron/net. The only expected failure there is `004_vector_search.sql` (its guard needs a real pgvector column).
