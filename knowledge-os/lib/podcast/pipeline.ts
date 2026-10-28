import { admin } from '../server';
import { writeScript, type SourceDoc } from './script';
import { synthesizeScript } from './tts';
import { mp3DurationSec } from './audio';
import { putMp3 } from './r2';

export const DEFAULT_VOICES = { A: process.env.TTS_VOICE_A ?? 'alloy', B: process.env.TTS_VOICE_B ?? 'nova' };

/** Runs one claimed episode end to end. Throws are caught by the caller, which records the error. */
export async function produceEpisode(ep: any) {
  const { data: items } = await admin.from('oneclist_items').select('id,title,url,summary,note,content_text').eq('user_id', ep.user_id).in('id', ep.source_item_ids);
  const docs: SourceDoc[] = (items ?? [])
    .map((i) => ({ id: i.id, title: i.title || i.url, url: i.url, text: [i.content_text, i.summary, i.note].filter(Boolean).join('\n\n') }))
    .filter((d) => d.text.trim().length > 80);
  if (!docs.length) throw new Error('none of the selected items has readable text');

  const script = await writeScript(docs, { targetMinutes: ep.target_minutes, style: ep.style });
  await admin.from('podcast_episodes').update({ status: 'synthesizing', script: script.turns, title: script.episode_title, description: script.description }).eq('id', ep.id);

  const voices = { A: ep.voice_a ?? DEFAULT_VOICES.A, B: ep.voice_b ?? DEFAULT_VOICES.B };
  const mp3 = await synthesizeScript(script.turns, voices);
  const key = `podcasts/${ep.user_id}/${ep.id}.mp3`;
  await putMp3(key, mp3);

  await admin.from('podcast_episodes').update({
    status: 'ready', audio_key: key, audio_bytes: mp3.length, duration_sec: mp3DurationSec(mp3) || Math.round(script.turns.reduce((n, t) => n + t.text.split(/\s+/).length, 0) / 2.5),
    published_at: new Date().toISOString(), error: null,
  }).eq('id', ep.id);
}

/** Claim + run (called by the API route via after() and by the cron drain). Returns false when the queue is empty. */
export async function processNextEpisode(): Promise<boolean> {
  const { data } = await admin.rpc('claim_next_episode');
  const ep = Array.isArray(data) ? data[0] : data;
  if (!ep) return false;
  try { await produceEpisode(ep); }
  catch (e: any) {
    await admin.from('podcast_episodes').update({ status: ep.attempts >= 3 ? 'failed' : 'queued', error: String(e?.message ?? e).slice(0, 500) }).eq('id', ep.id);
  }
  return true;
}
