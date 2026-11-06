'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Record a voice note in the browser and send it to POST /api/vault/voice.
 *  Chrome/Android/desktop produce webm (opus); Safari/iPhone produce mp4 (m4a): both are accepted by the route.
 *  The recording stays in memory and is uploaded once; nothing is kept on the device. */

export interface SavedVoiceNote { id: string; title: string; summary: string; categories: string[]; transcript: string; embedded: boolean }

const MAX_SECONDS = 300;                       // 5 min per note on the client (the server allows up to 10)
const MAX_BYTES = 12 * 1024 * 1024;
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

const MESSAGES: Record<string, string> = {
  no_speech: 'We couldn’t hear any speech. Try again a bit closer to the microphone.',
  file_size: 'That recording is too large. Keep notes under a few minutes.',
  too_long: 'That recording is too long. Keep it under 10 minutes.',
  unsupported_audio: 'This browser recorded a format we can’t read yet.',
  unreadable_audio: 'We couldn’t read that recording. Please try again.',
  daily_limit: 'You’ve reached today’s voice note limit. Try again tomorrow.',
  transcription_failed: 'Transcription is unavailable right now. Please try again.',
  not_configured: 'Voice notes aren’t switched on yet.',
};

type Phase = 'idle' | 'recording' | 'saving' | 'done' | 'error';
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export default function VoiceRecorder({ onSaved }: { onSaved?: (n: SavedVoiceNote) => void }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [secs, setSecs] = useState(0);
  const [msg, setMsg] = useState<{ text: string; upgrade?: string } | null>(null);
  const [note, setNote] = useState<SavedVoiceNote | null>(null);
  const rec = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null), chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null), discard = useRef(false), started = useRef(0);

  const release = useCallback(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    stream.current?.getTracks().forEach(t => t.stop()); stream.current = null;          // turns the browser's recording indicator off
  }, []);
  useEffect(() => () => { discard.current = true; if (rec.current?.state === 'recording') rec.current.stop(); release(); }, [release]);

  const upload = useCallback(async (blob: Blob) => {
    setPhase('saving');
    try {
      const fd = new FormData();
      const ext = blob.type.includes('mp4') ? 'm4a' : 'webm';
      fd.append('audio', new File([blob], `voice.${ext}`, { type: blob.type }));
      const r = await fetch('/api/vault/voice', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({} as Record<string, unknown>));
      if (r.status === 401) { window.location.assign('/login?next=/m/voice'); return; }
      if (r.status === 402) { const up = typeof j.upgradeUrl === 'string' && j.upgradeUrl.startsWith('/') ? j.upgradeUrl : '/pricing'; setMsg({ text: String(j.message ?? 'You’ve reached your plan limit.'), upgrade: up }); setPhase('error'); return; }
      if (!r.ok) { setMsg({ text: MESSAGES[String(j.error)] ?? 'Couldn’t save that note. Please try again.' }); setPhase('error'); return; }
      const saved = j as unknown as SavedVoiceNote; setNote(saved); setPhase('done'); onSaved?.(saved);
    } catch { setMsg({ text: 'No connection. Your recording wasn’t saved. Please try again.' }); setPhase('error'); }
  }, [onSaved]);

  async function start() {
    setMsg(null); setNote(null);
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) { setMsg({ text: 'This browser can’t record audio.' }); setPhase('error'); return; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      stream.current = s;
      const mime = TYPES.find(t => MediaRecorder.isTypeSupported(t));
      const r = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      chunks.current = []; discard.current = false; rec.current = r;
      r.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = () => {
        release();
        if (discard.current) { setPhase('idle'); return; }
        const blob = new Blob(chunks.current, { type: r.mimeType || mime || 'audio/webm' });
        if (Date.now() - started.current < 800 || blob.size < 1000) { setMsg({ text: 'That was too short. Hold on a little longer.' }); setPhase('error'); return; }
        if (blob.size > MAX_BYTES) { setMsg({ text: MESSAGES.file_size }); setPhase('error'); return; }
        void upload(blob);
      };
      r.start(1000); started.current = Date.now(); setSecs(0); setPhase('recording');
      timer.current = setInterval(() => setSecs(v => { if (v + 1 >= MAX_SECONDS && rec.current?.state === 'recording') rec.current.stop(); return v + 1; }), 1000);
    } catch (e) {
      release();
      const n = (e as DOMException).name;
      setMsg({ text: n === 'NotAllowedError' || n === 'SecurityError' ? 'Microphone access is blocked. Allow it in your browser’s site settings, then try again.' : n === 'NotFoundError' ? 'No microphone was found.' : 'Couldn’t start the microphone.' });
      setPhase('error');
    }
  }
  const stop = () => { if (rec.current?.state === 'recording') rec.current.stop(); };
  const cancel = () => { discard.current = true; if (rec.current?.state === 'recording') rec.current.stop(); else release(); };

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      {phase === 'recording' ? (
        <>
          <button onClick={stop} aria-label="Stop and save" className="relative grid h-24 w-24 place-items-center rounded-full bg-[#b42318] text-white shadow-lg">
            <span className="absolute inset-0 animate-ping rounded-full bg-[#b42318]/40 motion-reduce:animate-none" aria-hidden="true" />
            <span className="relative h-7 w-7 rounded-md bg-white" aria-hidden="true" />
          </button>
          <p role="timer" aria-live="off" className="text-2xl font-semibold tabular-nums">{fmt(secs)}</p>
          <p className="text-sm text-[#5b7266]">Recording… tap to stop and save</p>
          <button onClick={cancel} className="text-sm font-medium text-[#b42318] underline">Discard</button>
        </>
      ) : phase === 'saving' ? (
        <>
          <div className="grid h-24 w-24 place-items-center rounded-full bg-[#d9f2e2]"><span className="h-8 w-8 animate-spin rounded-full border-4 border-[#1a7f4e] border-t-transparent motion-reduce:animate-none" aria-hidden="true" /></div>
          <p role="status" className="text-sm text-[#5b7266]">Transcribing and filing your note…</p>
        </>
      ) : (
        <>
          <button onClick={start} aria-label={phase === 'done' ? 'Record another voice note' : 'Start recording'} className="grid h-24 w-24 place-items-center rounded-full bg-[#1a7f4e] text-white shadow-lg">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
          </button>
          <p className="text-sm text-[#5b7266]">{phase === 'done' ? 'Saved. Tap to record another.' : 'Tap to record a quick voice note'}</p>
        </>
      )}

      {phase === 'error' && msg && (
        <p role="alert" className="max-w-sm text-sm text-[#b42318]">{msg.text} {msg.upgrade && <a href={msg.upgrade} className="font-semibold underline">See plans</a>}</p>)}

      {phase === 'done' && note && (
        <article className="w-full max-w-sm rounded-2xl border border-[#d6e8dc] bg-white p-4 text-left">
          <h2 className="text-base font-bold leading-tight">{note.title}</h2>
          <p className="mt-1.5 text-sm text-[#26402f]">{note.summary}</p>
          <p className="mt-2">{note.categories.map(c => <span key={c} className="mr-1.5 inline-block rounded-full bg-[#d9f2e2] px-2 py-0.5 text-[11.5px] text-[#0f5c36]">{c}</span>)}</p>
          <details className="mt-3 text-sm"><summary className="cursor-pointer text-[#5b7266]">Full transcript</summary><p className="mt-1.5 whitespace-pre-wrap text-[#26402f]">{note.transcript}</p></details>
          {!note.embedded && <p className="mt-2 text-xs text-[#5b7266]">Search indexing will finish in the background.</p>}
        </article>)}
    </div>
  );
}
