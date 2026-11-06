import { randomUUID } from 'node:crypto';
import { admin, json, requireUser, ANTHROPIC_MODEL } from '@/lib/server';
import { claudeTool } from '@/lib/llm';
import { assertBudget, recordUsage, BudgetExceededError, FALLBACK_MODEL } from '@/lib/ai/circuitBreaker';
import { checkFeatureLimit, refundFeature } from '@/lib/planLimits';
import { gateErrorResponse } from '@/lib/http/limit';
import { AUDIO_MAX_BYTES, MAX_SECONDS, NOTE_MAX_CHARS, SCHEMA, SYSTEM, embedInput, parseNote, sameOriginOrBearer, sniffAudio, type VoiceNote } from '@/lib/voice/core';

export const runtime = 'nodejs';
export const maxDuration = 120;

const NO_STORE = { 'cache-control': 'no-store' };
const DAILY_LIMIT = Number(process.env.VOICE_NOTES_PER_DAY ?? 100);
const STT_MODEL = process.env.VOICE_STT_MODEL ?? 'whisper-1';              // verbose_json (with duration) is a whisper-1 feature
const NOTE_MODEL = process.env.VOICE_NOTE_MODEL ?? 'claude-haiku-5-5';
const EMBED_MODEL = process.env.EMBED_MODEL ?? 'text-embedding-3-small';   // 1536 dims, matches oneclist_items.embedding vector(1536)

/**
 * POST /api/vault/voice   multipart/form-data
 *   audio    required  .mp3, .webm or .m4a (Safari), <= 12 MB (format is decided from the file's bytes)
 *   language optional  ISO-639-1 code ("en", "hi"…) to help Whisper; omitted = auto-detect
 * -> 201 { id, title, summary, categories, transcript, embedded }
 *    400 audio_required | 413 file_size / too_long | 415 unsupported_audio | 422 no_speech | 401 | 402 limit/budget | 429 daily_limit | 502 transcription_failed
 *
 * PRIVACY: the recording is held in memory only and is NOT stored; only the transcript, summary, tags and embedding are.
 * It is sent to OpenAI (Whisper) for transcription and the transcript to Anthropic and OpenAI for tagging and embedding. Say so in the privacy policy.
 * Not charged: a bad request, a failed transcription, or silence (the plan unit is given back).
 */
export async function POST(req: Request) {
  if (!sameOriginOrBearer(req)) return json({ error: 'forbidden' }, 403, NO_STORE);
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401, NO_STORE);

  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > AUDIO_MAX_BYTES + 64 * 1024) return json({ error: 'file_size', maxBytes: AUDIO_MAX_BYTES }, 413, NO_STORE);   // refuse before buffering the body

  const form = await req.formData().catch(() => null);
  const file = form?.get('audio');
  if (!(file instanceof File)) return json({ error: 'audio_required' }, 400, NO_STORE);
  if (file.size === 0 || file.size > AUDIO_MAX_BYTES) return json({ error: 'file_size', maxBytes: AUDIO_MAX_BYTES }, 413, NO_STORE);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const audio = sniffAudio(bytes);
  if (!audio) return json({ error: 'unsupported_audio', hint: 'Send an .mp3, .webm or .m4a recording.' }, 415, NO_STORE);
  const langRaw = form?.get('language');
  const language = typeof langRaw === 'string' && /^[a-z]{2}$/.test(langRaw) ? langRaw : undefined;

  const since = new Date(Date.now() - 864e5).toISOString();
  const { count } = await admin.from('oneclist_items').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('source', 'voice').gte('created_at', since);
  if ((count ?? 0) >= DAILY_LIMIT) return json({ error: 'daily_limit', limit: DAILY_LIMIT }, 429, NO_STORE);

  let budget;
  try { budget = await assertBudget(user.id); }
  catch (e) { if (e instanceof BudgetExceededError) return json(e.toJSON(), 402, NO_STORE); throw e; }
  try { await checkFeatureLimit(user.id, 'index'); }                      // a voice note is one more indexed item
  catch (e) { const r = gateErrorResponse(e); if (r) return r; throw e; }

  const refund = () => refundFeature(user.id, 'index');
  if (!process.env.OPENAI_API_KEY) { await refund(); console.error('voice: OPENAI_API_KEY missing'); return json({ error: 'not_configured' }, 503, NO_STORE); }

  // 1) Transcribe (Whisper). The audio goes straight from memory to OpenAI.
  let transcript = '', seconds = 0;
  try {
    const fd = new FormData();
    fd.append('file', new Blob([bytes], { type: audio.mime }), `voice.${audio.ext}`);
    fd.append('model', STT_MODEL); fd.append('response_format', STT_MODEL === 'whisper-1' ? 'verbose_json' : 'json');
    if (language) fd.append('language', language);
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: fd, signal: AbortSignal.timeout(90_000) });
    if (!r.ok) { await refund(); console.error('voice: whisper', r.status); return json({ error: r.status === 400 ? 'unreadable_audio' : 'transcription_failed' }, r.status === 400 ? 422 : 502, NO_STORE); }
    const j = (await r.json()) as { text?: unknown; duration?: unknown };
    transcript = typeof j.text === 'string' ? j.text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, NOTE_MAX_CHARS) : '';
    seconds = typeof j.duration === 'number' && j.duration > 0 ? j.duration : bytes.length / 16_000;
  } catch (e) { await refund(); console.error('voice: whisper failed', (e as Error).name); return json({ error: 'transcription_failed' }, 502, NO_STORE); }
  await recordUsage({ userId: user.id, feature: 'voice_stt', model: STT_MODEL, inputTokens: Math.ceil(seconds), outputTokens: 0, degraded: budget.degraded });   // priced per audio second, see lib/ai/pricing.ts
  if (seconds > MAX_SECONDS) { await refund(); return json({ error: 'too_long', maxSeconds: MAX_SECONDS }, 413, NO_STORE); }
  if (transcript.replace(/[\s\p{P}]/gu, '').length < 3) { await refund(); return json({ error: 'no_speech' }, 422, NO_STORE); }

  // 2) Two-sentence note + 3 categories (soft-fail: the transcript is saved either way, and the enrichment worker can fill the rest in later).
  let note: VoiceNote & { fromModel: boolean };
  try {
    const model = budget.degraded ? FALLBACK_MODEL() : NOTE_MODEL;
    const raw = await claudeTool<unknown>({
      system: SYSTEM, toolName: 'record_voice_note', schema: SCHEMA, maxTokens: 400, model: model || ANTHROPIC_MODEL, signal: AbortSignal.timeout(20_000),
      content: `<transcript>\n${transcript.slice(0, 12_000)}\n</transcript>`,
      onUsage: (u) => { void recordUsage({ userId: user.id, feature: 'voice_note', model: u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens, degraded: budget.degraded }); },
    });
    note = parseNote(raw, transcript);
  } catch (e) { console.error('voice: summarize failed', (e as Error).message.slice(0, 120)); note = parseNote(null, transcript); }

  // 3) Embed for semantic search (soft-fail: ai_status 'pending' lets the existing enrichment worker embed it later).
  let embedding: string | null = null;
  try {
    const input = embedInput(note, transcript);
    const r = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST', signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: JSON.stringify({ model: EMBED_MODEL, input }),
    });
    if (r.ok) {
      const j = (await r.json()) as { data?: { embedding?: unknown }[]; usage?: { total_tokens?: number } };
      const v = j.data?.[0]?.embedding;
      if (Array.isArray(v) && v.length === 1536 && v.every((x) => typeof x === 'number' && Number.isFinite(x))) embedding = `[${v.join(',')}]`;
      await recordUsage({ userId: user.id, feature: 'voice_embed', model: EMBED_MODEL, inputTokens: j.usage?.total_tokens ?? Math.ceil(input.length / 4), outputTokens: 0, degraded: budget.degraded });
    }
  } catch (e) { console.error('voice: embed failed', (e as Error).name); }

  // 4) Save. Voice notes have no web address, so they get an internal one (same pattern as scanned documents).
  const id = randomUUID();
  const { error } = await admin.from('oneclist_items').insert({
    id, user_id: user.id, title: note.title, url: `bukmarkz://voice/${id}`, url_key: `voice/${id}`,
    summary: note.summary, note: transcript, ai_tags: note.categories, embedding,
    source: 'voice', status: 'bookmark',
    ai_status: embedding && note.fromModel ? 'done' : 'pending',             // 'pending' = the existing worker finishes what we could not
  });
  if (error) { await refund(); console.error('voice: save failed', error.code); return json({ error: 'server_error' }, 500, NO_STORE); }
  return json({ id, title: note.title, summary: note.summary, categories: note.categories, transcript, embedded: !!embedding }, 201, NO_STORE);
}
