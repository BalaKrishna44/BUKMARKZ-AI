# Vault MCP Pro

MCP server for Bukmarkz (Streamable HTTP transport, stateless). Tools: `search_vault`, `save_bookmark` (Pro), `get_recent_highlights`, `synthesize_vault_topics`.

## Install
1. Run `sql/013_mcp.sql` (needs `oneclist_items` with `is_private`, `fts`, `embedding_model` from importexport/004).
2. Copy `lib/mcp/`, `app/api/mcp/`. Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY` (query embeddings), `ANTHROPIC_API_KEY`; optional `MCP_SUMMARY_MODEL` (default `claude-haiku-5-5`), `NEXT_PUBLIC_SITE_URL`.
3. Billing webhook: upsert `user_plans(user_id, plan, current_period_end)`; `pro`/`team` with an unexpired period = Pro tier, anything else = Free.
4. The settings page creates tokens with `POST /api/mcp/tokens {name}` (shown once), lists with GET, revokes with `DELETE {id}`.

## Client config
Cursor (`~/.cursor/mcp.json`):
```json
{ "mcpServers": { "bukmarkz": { "url": "https://bukmarkz.com/api/mcp", "headers": { "Authorization": "Bearer buk_mcp_..." } } } }
```
Claude Desktop (`claude_desktop_config.json`, via the `mcp-remote` bridge):
```json
{ "mcpServers": { "bukmarkz": { "command": "npx", "args": ["-y", "mcp-remote", "https://bukmarkz.com/api/mcp", "--header", "Authorization:${BUK_AUTH}"], "env": { "BUK_AUTH": "Bearer buk_mcp_..." } } } }
```
Smoke test: `curl -s https://bukmarkz.com/api/mcp -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`

## Rules
- Free: 50 `tools/call` per UTC month, read-only. Pro: unlimited read/write. Both: 60 calls/minute.
- Only `tools/call` is metered, and only after the plan check and argument validation pass. Our own failures are refunded.
- Private items (`is_private`, `ai_status='skipped_private'`) are never returned or sent to a model.

## Tests
`npx tsx test/mcp.test.ts` (no database), `test/run_mcp_sql.sh` (PostgreSQL 16 binaries).
