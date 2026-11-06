# Vault MCP: directory listing copy and the "Bukmarkz in Cursor" guide

Facts below come from `knowledge-os/lib/mcp/README.md` and the plan-gating limits. **Before you publish, run the checklist at the end** (directory rules change; I could not submit anything from my sandbox).

## Listing copy (paste into MCP directories and your docs page)

**Name:** Bukmarkz Vault
**One-liner:** Search your saved links and notes from Cursor or Claude Desktop, and save new links without leaving your editor.
**Transport:** Streamable HTTP, stateless. **Endpoint:** `https://bukmarkz.com/api/mcp`. **Auth:** `Authorization: Bearer buk_mcp_...` (create a token in Settings > Vault MCP; it is shown once).
**Tools**
| Tool | What it does | Plan |
|---|---|---|
| `search_vault` | Semantic + keyword search across your saved pages, with source links | Free and Pro |
| `save_bookmark` | Saves a URL (optional note and tags) to your vault | Pro |
| `get_recent_highlights` | Returns your most recent highlights | Free and Pro |
**Limits:** Free 50 tool calls a month (read-only). Pro 10,000 a month. Both 60 calls a minute.
**Privacy:** items you mark private are never returned or sent to a model.

Short description (for 140-character fields): *Search your saved links from Cursor or Claude Desktop, and save new ones. Your vault, in your editor.*

## Guide: use your vault in Cursor (2 minutes)
1. In Bukmarkz open **Settings > Vault MCP** and create a token. Copy it now; it is only shown once.
2. Open `~/.cursor/mcp.json` (or Cursor Settings > MCP) and add:
   ```json
   { "mcpServers": { "bukmarkz": { "url": "https://bukmarkz.com/api/mcp", "headers": { "Authorization": "Bearer buk_mcp_PASTE_YOUR_TOKEN" } } } }
   ```
3. Restart Cursor. In the MCP list you should see **bukmarkz** with its tools.
4. Try: *"Search my vault for notes on pgvector index tuning and summarise them."* Cursor calls `search_vault` and answers with your own sources.
5. Pro only: *"Save https://example.com/article to my vault with the tag rls."* Cursor calls `save_bookmark`.

**Claude Desktop** uses the `mcp-remote` bridge instead:
```json
{ "mcpServers": { "bukmarkz": { "command": "npx", "args": ["-y", "mcp-remote", "https://bukmarkz.com/api/mcp", "--header", "Authorization:${BUK_AUTH}"], "env": { "BUK_AUTH": "Bearer buk_mcp_PASTE_YOUR_TOKEN" } } } }
```
**Check it works without an editor:**
```bash
curl -s https://bukmarkz.com/api/mcp -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
**Troubleshooting**
- *No tools show up:* restart the editor fully; check the JSON is valid and the token starts with `buk_mcp_`.
- *"limit_exceeded" in a tool result:* the monthly quota is used up (Free 50, Pro 10,000); the message includes an upgrade link.
- *HTTP 429:* more than 60 calls a minute; wait for the `Retry-After` seconds.
- *HTTP 401:* the token was revoked or mistyped. Create a new one.
- *Treat the token like a password.* Revoke it in Settings if it ever appears in a screenshot or a repo.

## Post ideas that fit developer audiences (write them in your own voice)
- "Stop re-googling the same doc: I plugged my bookmarks into Cursor" with a 20-second screen capture of step 4.
- "How I made `save_bookmark` safe: per-token rate limits, fail-closed metering, private items never exposed" (the QA suite's MCP tests are the evidence).

## Checklist before you publish
- [ ] The token page really lives at Settings > Vault MCP (adjust the wording to your UI).
- [ ] Pro/Free limits above still match `PLAN_LIMITS`.
- [ ] Use a throwaway token in screenshots, then revoke it.
- [ ] Check each directory's current submission rules and categories; submit from your account.
- [ ] Add a docs page at a stable URL (for example `/docs/mcp`) and link it from every listing.
