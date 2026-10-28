# Bukmarkz enrichment worker

Fetches each new bookmark, asks Claude or Gemini to classify it, and writes the result back to `oneclist_items`.

## Install
    npm i zod @supabase/supabase-js        # Next.js 15+ (uses `after`)
    # run sql/006_enrichment.sql in the Supabase SQL editor

Files: `lib/enrichmentService.ts`, `app/api/enrich/route.ts`, `sql/006_enrichment.sql`.

## Environment (server only; never NEXT_PUBLIC_)
| Variable | Purpose |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | database access (service role bypasses RLS: keep it secret) |
| `ANTHROPIC_API_KEY` and/or `GEMINI_API_KEY` | at least one; the other is the automatic fallback |
| `ENRICH_PROVIDER` | `anthropic` (default) or `gemini`: which to try first |
| `ENRICH_ANTHROPIC_MODEL`, `ENRICH_GEMINI_MODEL` | defaults `claude-haiku-5-5`, `gemini-2.5-flash`. Check current model names before deploying. |
| `ENRICH_WEBHOOK_SECRET` | shared secret for the webhook |
| `CRON_SECRET` | Vercel Cron bearer token for the sweep |

## Wire it up
1. **Webhook**: Supabase > Database > Webhooks > new, table `oneclist_items`, event INSERT, POST to
   `https://YOUR_DOMAIN/api/enrich`, header `x-webhook-secret: <ENRICH_WEBHOOK_SECRET>`.
2. **Safety net**: `vercel.json` -> `{"crons":[{"path":"/api/enrich","schedule":"*/10 * * * *"}]}`
   picks up rows that failed, timed out, or were saved before the webhook existed.
3. New rows must start with `status = 'pending'` (see the comment in the SQL file). To process old rows:
   `update oneclist_items set status='pending' where status is distinct from 'processed';`

## What it writes
`category_id` (only if empty; the six categories are created per user on first use), `summary`, `ai_tags` (stored without `#`),
`suggested_actions`, `favicon_url` and `meta_description` (only if empty), `og_image`, `title` (only if it was empty or the URL),
`status='processed'`. On failure: back to `pending` up to 3 attempts, then `failed` with `enrich_error`.

## Notes
- Page text is sent to the model provider you choose. Do not enrich private or encrypted items; filter them out of the webhook.
- Every URL is checked against private/internal networks, including after redirects, so a saved link can't be used to reach your own infrastructure.
- Cost: about 1-3k input tokens per page (2,000-word cap), 700 max output.
