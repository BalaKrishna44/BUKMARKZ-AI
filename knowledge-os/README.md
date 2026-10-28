# Bukmarkz Knowledge OS — backend for feeds, podcast, graph and document OCR

Next.js App Router · Supabase (Postgres + pgvector) · Cloudflare R2 · Claude / OpenAI / ElevenLabs / Gemini.
Drop `sql/`, `lib/`, `worker/`, `app/api/` into the existing app (they assume migrations 001-004 already ran) and add the deps in `package.json`.

```
                       ┌──────────────────────────── Supabase ────────────────────────────┐
 RSS/Atom sites        │ feeds ─< feed_entries ──save──▶ oneclist_items ◀── scan ──┐       │
   ▲ conditional GET   │                                    │  │  │                │       │
   │ SSRF-safe         │            ai_status='pending'─────┘  │  └─ item_edges    │       │
 ┌─┴────────────┐      │            (existing enrich+embed)    │     (graph)       │       │
 │ feedWorker   │──────▶            content_text ──────────────┘                    │       │
 │ cron / loop  │      │ podcast_episodes ◀── generate-podcast ... podcast_feeds(token)    │
 └──────────────┘      └─────────────▲───────────────────────────────────────▲───────────┘
                                     │                                       │
   Claude (script) → TTS (OpenAI/ElevenLabs) → R2 .mp3 ← signed 302 ← /api/podcast/{token}/ep/{id}.mp3
                                                         feed.xml  ← /api/podcast/{token}/feed.xml  (Apple Podcasts, Overcast, ...)
   phone/web ──decrypted photo, user-initiated──▶ /api/ocr/analyze ──▶ Claude Vision | Gemini ──▶ validated JSON ──▶ item fields
```

## 1. Private RSS aggregator
- **Tables:** `feeds` (conditional-GET state, lease, backoff), `feed_entries` (sanitized HTML + plain text, unique `(feed_id, guid)`), links to `oneclist_items` via `saved_item_id`.
- **Worker** (`worker/feedWorker.ts`): `claim_due_feeds` leases feeds with `FOR UPDATE SKIP LOCKED`, so any number of workers/cron invocations can run without double-fetching. ETag / If-Modified-Since, ±10% interval jitter, exponential backoff capped at 24 h, honours `Retry-After`, marks a feed `broken` after 10 failures, prunes unsaved entries older than 90 days. Runs as a loop (`tsx worker/feedWorker.ts`) or via `GET /api/cron/feeds`.
- **Safety:** user-supplied URLs are the classic SSRF vector. `lib/netguard.ts` blocks loopback/private/link-local/CGNAT/metadata ranges (v4, v6, v4-mapped), odd ports, credentials, internal hostnames. `lib/ssrf.ts` performs the check inside the socket's DNS lookup (no resolve-then-connect window for DNS rebinding), re-validates every redirect hop, caps size (5 MB) and time (15 s). Feed HTML goes through an allow-list sanitizer (`lib/html.ts`): no scripts, iframes, forms, event handlers or non-http(s) links.
- **API:** `POST /api/feeds {url}` (feed URL or site URL, auto-discovers `<link rel=alternate>`, validates before storing), `GET /api/feeds`, `POST /api/feeds/entries/{id}/save` (1-click, idempotent by `url_key`, sets `ai_status='pending'` so the existing pipeline tags + embeds it).

## 2. Private podcast
- `POST /api/audio/generate-podcast {itemIds[1..10], style, targetMinutes, voiceA?, voiceB?}` validates ownership and that each item has readable text, enforces a daily cap, creates a `queued` episode and returns **202** with the feed URL. Work starts via Next's `after()`; `GET /api/cron/podcast` re-claims queued or stuck episodes (3 attempts), so a serverless timeout never loses an episode.
- **Script:** Claude via forced tool use → `{title, description, turns[{A|B, text}]}`, validated with zod. Sources are passed as JSON data inside `<sources>` and the prompt forbids following instructions found there, and forbids facts not in the sources.
- **Audio:** long turns are split on sentence boundaries (providers cap input), 3 requests in flight, order preserved, segments joined with ID3 tags stripped, duration read from the MP3 frame headers.
- **Feed:** `GET /api/podcast/{token}/feed.xml` (256-bit token in the URL = the credential, because podcast apps cannot send headers; `noindex`, `itunes:block`, ETag/304). Enclosures point to `/ep/{id}.mp3`, which 302-redirects to a 15-minute signed R2 URL (R2 serves Range requests). `POST /api/podcast/token` rotates the token and kills the old URL.
- **Client support:** Apple Podcasts ("Follow a Show by URL"), Overcast, Pocket Casts, AntennaPod accept private feed URLs. **Spotify does not accept arbitrary private RSS feeds.**

## 3. Knowledge graph
- `item_edges(source_item_id < target_item_id, similarity_score)` — one row per undirected pair. `rebuild_item_edges(user, threshold, k, item_ids?)` takes each item's `k` nearest neighbours through the HNSW index (cosine), keeps pairs ≥ threshold, only compares vectors of the **same embedding model**, deletes stale edges first, and supports incremental rebuilds (pass the ids just enriched). It sets `hnsw.iterative_scan` so the per-user filter cannot starve results (pgvector ≥ 0.8).
- `GET /api/graph?threshold&limit` returns `{nodes, edges, clusters}` ready for React Flow or d3-force. Clusters come from deterministic weighted label propagation (`lib/graph/cluster.ts`), singletons are `-1`, clusters are named by their most common tag else their hub item. Photos appear as nodes once their OCR text has been embedded.
- `POST /api/graph/rebuild` (full rebuild limited to one per 5 minutes per user).

## 4. Document & receipt intelligence
- `POST /api/ocr/analyze` (multipart `file`, optional `itemId`, `provider`). Type is decided from the bytes, not the client's header (JPEG/PNG/WebP/GIF; HEIC is refused with a hint). Claude Vision (default) or Gemini Flash returns JSON through a forced tool / `responseSchema`; the result is validated with zod, then **reconciled**: line items + tax must match the total, dates must be real and not in the future, otherwise warnings are attached and confidence is capped.
- Saved to `doc_type, doc_vendor, doc_date, doc_total, doc_currency, doc_data (jsonb), doc_confidence` plus `ocr_extracted_text` (header line + takeaways + transcription) which feeds the existing full-text index and embedding. `spend_summary(user, from, to)` totals per vendor and currency (currencies are never mixed).
- **Conflict with the encrypted photo backup:** those photos are end-to-end encrypted, so the server *cannot* read them. This route only works on an image the client has decrypted and chosen to send ("Scan this receipt"); it is processed in memory and never stored. If you want scanning to stay fully private, run ML Kit / Apple Vision on-device and send only the text.
- `gemini-1.5-flash` has been retired; `GEMINI_MODEL` defaults to `gemini-2.5-flash`.

## 5. Tested vs. not tested
**Verified here**
- SQL (`test/sql_test.sql`, 32 checks, real PostgreSQL 16 with a stand-in for the `vector` type): all four migrations apply; edge rebuild thresholds, canonical ordering, idempotence, stale-edge removal, incremental rebuild, other-model/unembedded exclusion, **no cross-tenant edges**; RLS and revoked write/EXECUTE privileges; feed leasing (no double claim, expired lease reclaim, paused/future never claimed); episode claiming (single claim, stuck re-claim, 3-attempt stop); spend totals; check constraints.
- Pure logic (`test/logic.test.ts`, 71 checks): SSRF address/URL rules, TTS text chunking, MP3 duration/ID3 handling, podcast XML (parsed back with an independent XML parser, control characters stripped), graph clustering (determinism, bridge, singletons), receipt reconciliation, schema validation, image sniffing, feed discovery.
- Every `.ts` file parses.

**Not verified**
- Anything needing packages or networks unavailable in this sandbox: `rss-parser` and `sanitize-html` behaviour (their config is standard but unrun), the undici DNS-lookup guard in `safeFetch`, the route handlers inside a real Next 15 app (`after()`, async `params`), Supabase auth, R2 signing, and the Claude / OpenAI / ElevenLabs / Gemini calls.
- pgvector itself: HNSW usage, iterative scans and real recall were not exercised (stub type). Check `explain` on `rebuild_item_edges` with real data.
- Concatenated MP3 segments from separate TTS calls play fine in most players but are not gapless; if you hear clicks, re-encode once with ffmpeg in the worker.
- Type-checking (`tsc`) was not run against the real dependencies.

## 6. Cost and abuse controls already in
Daily episode cap, daily scan cap, 200-feed cap, 10 items per episode, 6,000 characters per source, 5 MB image cap, full-graph-rebuild throttle, SSRF guard, size/time bounds on every outbound fetch. Add real rate limiting (e.g. Upstash) in front of the LLM-backed routes before launch.
