import { chunkText, concatMp3 } from './audio';

export interface TtsProvider { name: string; synthesize(text: string, voice: string): Promise<Uint8Array> }

const retry = async <T>(fn: () => Promise<T>, tries = 3): Promise<T> => {
  let err: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e: any) {
      err = e; if (e?.status && e.status < 500 && e.status !== 429) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw err;
};

export const openAiTts: TtsProvider = {
  name: 'openai',
  async synthesize(text, voice) {
    return retry(async () => {
      const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST', signal: AbortSignal.timeout(120_000),
        headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: process.env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts', voice, input: text, response_format: 'mp3' }),
      });
      if (!res.ok) throw Object.assign(new Error(`openai tts ${res.status}: ${(await res.text()).slice(0, 200)}`), { status: res.status });
      return new Uint8Array(await res.arrayBuffer());
    });
  },
};

export const elevenLabsTts: TtsProvider = {
  name: 'elevenlabs',
  async synthesize(text, voiceId) {
    return retry(async () => {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
        method: 'POST', signal: AbortSignal.timeout(120_000),
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY!, 'content-type': 'application/json' },
        body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL ?? 'eleven_multilingual_v2' }),
      });
      if (!res.ok) throw Object.assign(new Error(`elevenlabs ${res.status}`), { status: res.status });
      return new Uint8Array(await res.arrayBuffer());
    });
  },
};

export const defaultTts = (): TtsProvider => (process.env.TTS_PROVIDER === 'elevenlabs' ? elevenLabsTts : openAiTts);

/** Synthesize every turn (long turns are split), 3 requests in flight, order preserved. */
export async function synthesizeScript(
  turns: { speaker: 'A' | 'B'; text: string }[],
  voices: { A: string; B: string },
  tts: TtsProvider = defaultTts(),
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const jobs = turns.flatMap((t) => chunkText(t.text).map((piece) => ({ piece, voice: voices[t.speaker] })));
  const out: Uint8Array[] = new Array(jobs.length); let next = 0, done = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    for (let i = next++; i < jobs.length; i = next++) {
      out[i] = await tts.synthesize(jobs[i].piece, jobs[i].voice);
      onProgress?.(++done, jobs.length);
    }
  }));
  return concatMp3(out);
}
