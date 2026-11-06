# profile-kit: profile pictures

| Piece | File |
|---|---|
| Table + public `avatars` bucket | `sql/031_avatars.sql` |
| Upload / remove route | `app/api/profile/avatar/route.ts` |
| Pure helpers (sniff, paths, CSRF) | `lib/profile/core.ts` |
| UI | `components/profile/Avatar.tsx`, `AvatarUploader.tsx`, `app/settings/profile/page.tsx` |

## How it stays safe
Browsers never write to storage or the table. The route checks same-origin, auth and size, sniffs the real type from the bytes (JPEG/PNG/WebP only; SVG, GIF and anything else is refused), pauses 5 s between uploads, then **decodes and re-encodes** to a 256x256 JPEG with EXIF rotation applied and **all metadata (including GPS) dropped**. The file is stored as `<user id>/<hash>.jpg`, so every change has a new address and caches never go stale. The stored address must match a strict pattern in the database as well as in `safeAvatar()` on read. The route also keeps `creator_profiles.avatar_url` in sync, so public Stacks show the same picture.

## Must do
- Run `031_avatars.sql` on Supabase (it creates the bucket when `storage.buckets` exists).
- **Delete-account must also delete the user's folder in the bucket.** Rows cascade; storage files do NOT: `admin.storage.from('avatars').list(userId)` then `.remove(...)`. Add this when you build delete-account.
- Privacy Policy already lists profile pictures under stored content.
- Use `<Avatar url name />` in the sidebar/header (fed from `user_profiles.avatar_url`); the dashboard shell is not wired yet.

## Tested / not tested
Passed: 25 Node checks against the real `sharp` (`test/avatar.test.ts`: type sniffing, metadata really removed, 256x256 output, CSRF, size limits, rate limit, failure cleanup, never deleting another user's file) and 11 Postgres 16 checks (`test/run_sql.sh`: address pattern, RLS, no direct writes, cascade, re-runnable).
Not run: against a real Supabase project/bucket, in a browser against the real route, with HEIC/very large photos from phones (HEIC is refused by design), and `next build`.
