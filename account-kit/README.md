# account-kit: delete account (GDPR / DPDP erasure)

Settings → Account → **Delete account**. Both legal pages promise this.

| Piece | File |
|---|---|
| Migration (run after 031) | `sql/032_erase_user.sql`, function `erase_user_data(uuid)`, service role only |
| API | `POST /api/account/delete` body `{confirm:"DELETE", email}` |
| Storage purge | `lib/account/erase.ts` (buckets `avatars`, `archives`, R2 `podcasts/<uid>/`) |
| UI | `/settings/account`, `components/account/DeleteAccount.tsx` |

## Safeguards
- Own-site cookie session only: Bearer tokens (extension, mobile, MCP) can never delete an account.
- Must have signed in within 30 minutes (else `reauth_required`), and typed email + `DELETE`.
- Order: database rows → files → login. Each step is repeatable, and the login goes last so a failed run can be retried.
- Discovers every `public` table with a `uuid user_id` column at run time (covers tables with no FK to `auth.users`, e.g. embeddings, reminders) and future tables automatically.
- Teams: last owner of an org that still has members is refused (409 `org_owner_blocked`). Content in shared orgs passes to another owner; an org with no other member is deleted.
- Logs counts only, no identifiers.

## Not covered (be honest in the privacy policy)
Backups (Supabase point-in-time backups age out on their own schedule), and third-party processors' logs (Resend, AI provider).

## Tests
`test/core.test.ts` (14, Node) and `test/run_sql.sh` (17, PG16: FK ordering, no-FK tables, org cases, re-run, grants). Run the SQL one as a non-root user.
