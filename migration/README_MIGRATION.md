# Django/Knox → Next.js + Supabase

Run order for SQL: importexport/sql/001, 002, then migration/sql/003.

## What moves, what does not
| Django | Supabase | Notes |
|---|---|---|
| CustomUser | auth.users (Admin API) | id = uuid5(django id), so re-runs are safe. `app_metadata` keeps `legacy_user_id`, `is_subscribed` |
| Category (flat) | collections + a tag | There is no Folder model and no nesting. Category title → collection and `ai_tags[0]` (disable with `--no-folder-tags`) |
| Bookmark | oneclist_items | name→title, description→note, tags→tags, timestamp→created_at, embedding copied when model matches |
| **Passwords** | **not migrated** | PBKDF2 hashes cannot be imported (Supabase takes bcrypt/argon2) |
| Passkeys, Stripe/subscription, referrals, offers, recommendations, magic links | **not migrated** | Separate work |

## Steps
1. Back up Django DB. Create the Supabase project; run the SQL files.
2. Pilot: `python migrate_django_to_supabase.py --email you@x.com` (dry run), then add `--execute --verify`.
3. Full dry run → read `migration_report.csv` → `--execute --verify`.
4. Deploy Next.js with `middleware.ts`, `app/api/auth/legacy-exchange/route.ts`, env:
   `DJANGO_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `LEGACY_TOKEN_SUNSET` (e.g. 2027-01-31).
5. Keep Django running (read-only) until the sunset date; then switch it off.
6. Tell users to sign in with a magic link / password reset (Supabase `resetPasswordForEmail`).
