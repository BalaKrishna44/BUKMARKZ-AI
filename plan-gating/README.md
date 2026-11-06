# Plan gating, feature limiters, upgrade prompts and the AI cost ledger

## What is in here
| Path | Purpose |
|---|---|
| `sql/016_plan_gating.sql` | `user_subscriptions`, `monthly_usage_meters`, `ai_index_state`, `ai_usage_ledger`, `ai_response_cache`; atomic `gate_consume` / refund / usage RPCs; MCP RPCs rewired; ledger, budget and cache RPCs |
| `lib/planLimits.ts` | `PLAN_LIMITS` (the only place caps live), `checkFeatureLimit`, `LimitExceededError`, `refundFeature`, `releaseIndexed`, `reconcileIndexed`, `getUsage` |
| `lib/upgrade.ts` | client-safe upgrade URLs, `readLimit(res)`, copy per feature |
| `lib/http/limit.ts` | `gateErrorResponse(e)` -> 402 / 503 JSON |
| `lib/mcp/errors.ts` | MCP tool-error text (`Free tier limit reached (50/50 calls...`) |
| `lib/ai/pricing.ts`, `lib/ai/circuitBreaker.ts` | cost per request, ledger, per-user budget, model downgrade, cache fallback |
| `app/api/usage/route.ts`, `app/api/ask/route.example.ts` | usage endpoint; the correct call order in an Ask route |
| `components/billing/UpgradePrompt.tsx` | inline upgrade card |
| `knowledge-os-patch/` | patched `lib/mcp/auth.ts`, `lib/mcp/protocol.ts`, `app/api/mcp/tokens/route.ts`, `test/mcp.test.ts`: copy over the 013 versions |
| `test/` | `run_sql.sh` (PG16, 30-parallel-caller test), `gating.test.ts` |

## Install
1. Run `016_plan_gating.sql` after 013 (it is safe to re-run).
2. Copy `lib/`, `app/`, `components/` into the app; copy `knowledge-os-patch/*` over the matching knowledge-os files.
3. **Billing webhook must now write `user_subscriptions`** (`plan`, `status`, `current_period_end`, optionally `monthly_price_usd` = what the user really pays per month: annual price / 12, or the per-seat price). Writing the old `user_plans` no longer works: it is now a read-only view.
4. Call `checkFeatureLimit` before billable work (see `app/api/ask/route.example.ts`), `releaseIndexed` when bookmarks are deleted, and run `reconcileIndexed` nightly.
5. Optional env: `AI_FREE_BUDGET_USD` (default 0.20), `AI_FALLBACK_MODEL` (default claude-haiku-5-5), `AI_GLOBAL_MONTHLY_CAP_USD` (kill switch), `AI_PRICE_OVERRIDES` (JSON), `ANTHROPIC_MODEL`.

## How limits behave
- Check and increment are one SQL statement: 30 parallel callers against a cap of 20 allow exactly 20.
- Denied calls are never counted. Our failures are refunded (`refundFeature`). If the gate cannot be evaluated, work is refused (503), never served unmetered.
- **Indexing is a stock, not a flow**: 300 / 25,000 is the total in the vault, tracked in `ai_index_state`; the monthly `ai_indexed_count` is only a count of events. `partial: true` indexes as many as fit during a big import.
- Plan resolution (`effective_plan`): active or trialing and unexpired -> that plan; `past_due` keeps access for 3 days; otherwise free.
- Months are UTC calendar months.

## AI circuit breaker
Budget = 25% of the plan's monthly price ($3 Pro, $6.25 Team per seat, fixed $0.20 for Free). Level by share of budget spent: under 80% ok, 80-100% warn, 100-200% degraded (Haiku, 400 output tokens, 6k chars of context), 200%+ blocked (cached answer, else 402). Cache is checked first. If the budget cannot be read the request is degraded, not unlimited.

## Things you must decide or verify
- **Pro MCP is 10,000 calls a month, not unlimited** (per your caps). If you want unlimited, set `PLAN_LIMITS.pro.mcp = null`; the SQL, MCP server and messages follow.
- Team caps (1,500 Asks, 1,000 snapshots) were not specified: they are placeholders.
- **Model prices**: Haiku 5.5 is $0.10 / $0.50 per million (prompts up to 100k tokens; higher above that, not modelled). Sonnet 5.5's price is a **placeholder ($3 / $15)**; set the real one in `AI_PRICE_OVERRIDES`. Unknown models are billed at a deliberately high fallback.
- The 25% rule uses the UTC calendar month, not the Stripe billing period.
- Page snapshots are gated (`snapshot`: 0 on Free) but nothing in this kit calls it yet.

## Not verified here
Next.js, React and Supabase were not run. SQL runs on PostgreSQL 16 with stubbed Supabase roles; TypeScript is strict-checked against stubs; `UpgradePrompt` is syntax-checked only.
