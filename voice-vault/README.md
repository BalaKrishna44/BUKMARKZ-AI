# voice-vault: record a voice note, get a searchable note

`POST /api/vault/voice` (multipart: `audio` = .mp3/.webm/.m4a up to 12 MB, optional `language`) → Whisper transcript → 2-sentence summary + 3 categories (Claude Haiku) → embedding (OpenAI, 1536-d) → saved in `oneclist_items`.

| File | What |
|---|---|
| `app/api/vault/voice/route.ts` | The route (POST only) |
| `components/voice/VoiceRecorder.tsx` | Browser recorder (MediaRecorder): record, timer, stop/discard, upload, result card, clear error messages |
| `app/m/voice/page.tsx` | Mobile screen with the recorder; a mic button sits next to + in the mobile layout |
| `lib/voice/core.ts` | Pure helpers: byte-sniffing of mp3/webm, same-origin guard, sentence clamp, model-output parsing, prompt + schema |
| `test/voice.test.ts` (+ `voice.stubs.ts`) | 36 checks with the DB, plan gate and the three APIs stubbed (esbuild with `--alias` for `@/…`, see the mobile-pwa test header) |

## How it saves
`url=bukmarkz://voice/<id>`, `url_key=voice/<id>`, `source='voice'`, `title`, `summary` (2 sentences), `note` = full transcript (both are in the full-text index), `ai_tags` = the 3 categories, `embedding`. `ai_status='done'` only if the model AND the embedding both worked; otherwise `'pending'`, and the existing enrichment worker finishes it.

## Rules it enforces
- Auth (cookie or Bearer); cookie requests must be same-origin (multipart forms need no CORS preflight, so this blocks cross-site posting).
- Format from the file's bytes, not its name; 12 MB cap checked from Content-Length before the body is read; max 10 min (`VOICE_MAX_SECONDS`); 100 notes/day (`VOICE_NOTES_PER_DAY`).
- AI budget gate (`assertBudget`) and one indexed-links unit per note (`checkFeatureLimit('index')`), **given back** if transcription fails, the audio is silent/too long, or the save fails.
- The transcript is passed to the model as untrusted data; every model field is clamped (title ≤ 80 chars, ≤ 2 sentences, ≤ 3 tags).
- The recording is never stored. It is sent to OpenAI (transcription); the transcript to Anthropic and OpenAI. **Add this to the privacy policy.**
- Cost ledger rows: `voice_stt` (priced per audio second via `whisper-1` in `plan-gating/lib/ai/pricing.ts`, **verify the rate**), `voice_note`, `voice_embed`.

## Env
`OPENAI_API_KEY` (required), `ANTHROPIC_API_KEY`, optional `VOICE_STT_MODEL` (default `whisper-1`; other models return `json` without duration), `VOICE_NOTE_MODEL`, `EMBED_MODEL`, `VOICE_MAX_SECONDS`, `VOICE_NOTES_PER_DAY`.

## Display
Voice notes and scans now appear in the dashboard and mobile Library as plain cards (no link). `dash/lib/bookmarks.ts` gained `kind` ('link' | 'voice' | 'scan'); only `bukmarkz://voice/<uuid>` and `bukmarkz://scan/<uuid>` are accepted besides http(s), everything else is still dropped (7/7 dash unit tests, including the new one).

## Not done / known gaps
- Tested: route with stubs (37 checks); the recorder in headless Chromium with a fake microphone (records, uploads real webm, shows result / no-speech / plan-limit / blocked-microphone messages). **Not tested:** Safari/iPhone (m4a path), a real microphone, a styled render (no Tailwind CDN offline), the real OpenAI/Anthropic APIs, Next.js.
- The recorder is on the mobile app only; a desktop dashboard button is not added (the component is reusable: `<VoiceRecorder onSaved={...} />`).
- No offline queue: if the upload fails the recording is lost (the message says so).
- Whisper can hallucinate short phrases on near-silence; the route only rejects empty text.
- 12 MB is buffered in memory per request; keep `maxDuration` and the daily cap in place.
- Privacy policy must say audio goes to OpenAI, transcript to Anthropic and OpenAI.
