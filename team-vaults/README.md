# Team Vaults: workspaces, shared items, org MCP

## Files
| Path | Purpose |
|---|---|
| `sql/017_team_vaults.sql` | tables, `is_org_member`, guard triggers, RLS, org MCP RPCs, `match_org_items`. Re-runnable. |
| `app/api/mcp/org/route.ts` | `POST /api/mcp/org`, bearer `buk_org_...`, search restricted to the token's workspace |
| `lib/mcp/org/{auth,tools,protocol,deps}.ts` | token handling, the `search_org_vault` tool, JSON-RPC, Supabase wiring |
| `app/api/orgs/[orgId]/mcp-tokens/route.ts` | admins create / list / revoke workspace tokens |
| `test/` | `run_sql.sh` (99 checks on PostgreSQL 16), `org-mcp.test.ts` (31 checks) |

Run 017 after 001 (items), 004 (search), 010 + 012 (stacks). It does not depend on 013 or 016.

## Roles
`viewer` reads. `editor` adds and edits shared items and stacks. `admin` also manages editors/viewers, deletes anything, renames the workspace, creates MCP tokens, publishes team stacks. `owner` also manages admins/owners and can delete the workspace. The last owner cannot leave or be demoted.

## Where each rule is enforced
- **RLS** limits which rows a signed-in user can see or touch at all.
- **Security-definer triggers** decide every change: `org_members_guard` (who can add, promote, remove whom; seat limit; last owner; no self role change), `org_items_guard` / `org_stacks_guard` (only the author, as editor, can share a personal item; leaving a workspace needs an admin who is also the author; team stacks go public only by an admin; shared items cannot be private), `organizations_guard`, `org_tokens_guard`. A hand-written UPDATE hits the trigger even if the policy would allow the row.
- Clients have no INSERT on `organizations` (use `create_org`), no direct token writes, and column-level grants only on `role`, `name/slug/billing_email`. `token_hash` is not readable.
- The server (service role, `auth.uid()` null) is trusted by the triggers. The org MCP route derives the workspace from the token and passes nothing else to SQL.

## What changed in existing tables
- `oneclist_items.org_id`, `stacks.org_id` (NULL = personal, nothing changes for personal use).
- `items_own` is replaced by `items_own_personal` (adds `org_id is null`); `stacks_owner` and `stack_items_owner` likewise. Org rows are covered by new policies.
- `create_stack` is redefined with one extra filter (`org_id is null`). Before this, a member could have published team items on a public stack through it. Tests cover it.
- Added a trigger on `auth.users` (BEFORE DELETE) so deleting an account promotes an heir and reassigns shared items instead of destroying them. A workspace whose only member deletes their account is dissolved.

## Behaviour you should know
- Removing a member (or an account deleting itself) reassigns their shared items and stacks to an owner, and revokes their workspace tokens. A removed person cannot reach team data through any path that filters by `user_id`.
- Workspace tokens stop working the moment the admin who created them is no longer an admin.
- Items: `unique(user_id, url_key)` from 001 is unchanged, so the same person cannot hold one URL both personally and in a workspace (share = move). A workspace also dedupes URLs across members.
- Seats: `organizations.seat_limit` (default 5) is enforced on adding members; set it from your billing webhook with the service role.
- `create_org` allows 3 workspaces per user. If migration 016 is installed, it requires the `team` plan (`org_creation_allowed`).
- Org MCP is metered per token (60/min) and per workspace (10,000 calls x seats per month, `ORG_MCP_MONTHLY_PER_SEAT`), separately from personal MCP.
- Workspace tokens are read-only (`scopes` is constrained to `read`); widen the check when a write tool exists.

## Limits and honest caveats
- Tested on PostgreSQL 16 with a stand-in for pgvector and Supabase roles. Real pgvector / HNSW was not run. HNSW filters after the index scan, so a small workspace inside a large table relies on pgvector >= 0.8 iterative scans (the function requests them).
- Service-role code that reads `oneclist_items` by `user_id` (exports, personal MCP, cron jobs) still returns org items the user authored while they are a member. That equals their access, but decide if exports should exclude `org_id is not null`.
- The triggers stand down when the internal flag `bukmarkz.org_internal` is set, which only the definer functions set. That is not reachable through PostgREST, but it would be through a raw SQL connection (which already has more power).
- `org_add_member_by_email` lets admins learn whether an email has an account. Replace with an invite flow if that matters.
- Next.js routes and Supabase were not run; TypeScript is strict-checked against stubs.

## Tag a colleague (027)
`sql/027_team_shares.sql` + `app/actions/tagColleague.ts` + `lib/shares/*` + `app/invite/team/[token]/page.tsx`. Tagging links the item to the workspace (`oneclist_items.org_id`) and emails an invite ("Sarah invited you to view a research stack on Bukmarkz"); the invitee joins as a **viewer** only after accepting with the invited address. Env: `RESEND_API_KEY`, `TEAM_INVITES_FROM`, `NEXT_PUBLIC_SITE_URL`. Tests: `test/run_shares.sh` (PG16) and `test/shares.test.ts`.
