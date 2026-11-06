'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { BookmarkParser } from '@/lib/import/parser';
import type { ParseResult } from '@/lib/import/types';

type Phase = 'idle' | 'importing' | 'enriching' | 'done' | 'error';
interface Progress { processed: number; total: number; inserted: number; duplicates: number }
const MAX_BYTES = 10 * 1024 * 1024;
const FORMAT_LABEL = { 'netscape-html': 'Netscape bookmarks (HTML)', csv: 'CSV', json: 'JSON', unknown: 'Unknown' } as const;
const nf = new Intl.NumberFormat('en-US');

/** Minimal SSE reader for fetch() responses (EventSource cannot POST a file). */
async function* readSse(res: Response): AsyncGenerator<{ event: string; data: any }> {
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { value, done } = await reader.read(); if (done) return;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const event = /^event: (.+)$/m.exec(block)?.[1] ?? 'message';
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (data) { try { yield { event, data: JSON.parse(data) }; } catch { /* ignore malformed frame */ } }
    }
  }
}

export default function ImportExportModal({ open, onClose, onImported, initialFile }: { open: boolean; onClose: () => void; onImported?: () => void; initialFile?: File | null }) {
  const [tab, setTab] = useState<'import' | 'export'>('import');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ParseResult | null>(null);
  const [ai, setAi] = useState(true);
  const [drag, setDrag] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [prog, setProg] = useState<Progress | null>(null);
  const [aiProg, setAiProg] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId(), aiId = useId();
  const busy = phase === 'importing' || phase === 'enriching';

  const reset = useCallback(() => { setFile(null); setPreview(null); setPhase('idle'); setProg(null); setAiProg(null); setError(null); }, []);
  const close = useCallback(() => { abort.current?.abort(); reset(); onClose(); }, [onClose, reset]);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); prev?.focus(); };
  }, [open, close]);

  async function choose(f: File | undefined) {
    if (!f || busy) return;
    reset();
    if (f.size > MAX_BYTES) { setError('That file is larger than 10 MB.'); return; }
    setFile(f);
    try {
      const r = new BookmarkParser().parse(await f.text(), f.name); // preview only; the server re-parses and is authoritative
      setPreview(r);
      if (!r.items.length) setError(r.warnings[0] ?? 'No importable bookmarks found in this file.');
    } catch { setError('Could not read that file.'); }
  }

  async function start() {
    if (!file || !preview?.items.length) return;
    setError(null); setPhase('importing'); setProg({ processed: 0, total: preview.items.length, inserted: 0, duplicates: 0 });
    const ctrl = new AbortController(); abort.current = ctrl;
    try {
      const fd = new FormData(); fd.set('file', file); fd.set('ai', String(ai));
      const res = await fetch('/api/import', { method: 'POST', body: fd, signal: ctrl.signal });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? `Import failed (${res.status})`);
      let jobId = '', wantAi = false;
      for await (const { event, data } of readSse(res)) {
        if (event === 'parsed') { jobId = data.jobId; wantAi = data.ai; setProg((p) => ({ ...(p as Progress), total: data.total })); }
        else if (event === 'progress') setProg(data);
        else if (event === 'error') throw new Error(data.message);
      }
      if (!jobId) throw new Error('Import ended unexpectedly. Re-upload the file to finish; duplicates are skipped.');
      onImported?.();
      if (wantAi) {
        setPhase('enriching');
        for (let guard = 0; guard < 500; guard++) { // each call works ≤45 s on the server
          const r = await fetch('/api/import/enrich', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId }), signal: ctrl.signal });
          if (!r.ok) throw new Error('AI organising paused. Your bookmarks are imported; it will finish in the background.');
          const j = await r.json(); setAiProg({ done: j.done + j.failed, total: j.total });
          if (j.remaining <= 0) break;
        }
        onImported?.();
      }
      setPhase('done');
    } catch (e) {
      if ((e as Error).name === 'AbortError') { setPhase('idle'); return; }
      setError((e as Error).message); setPhase('error');
    }
  }

  // A file dropped on the page (see GlobalImportDrop) arrives pre-selected.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && initialFile) { setTab('import'); void choose(initialFile); } }, [open, initialFile]);

  if (!open) return null;
  const pct = phase === 'enriching' && aiProg?.total ? (aiProg.done / aiProg.total) * 100 : prog?.total ? (prog.processed / prog.total) * 100 : 0;
  const skippedTotal = preview?.skipped.reduce((n, s) => n + s.count, 0) ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && !busy && close()}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0b0e16] text-slate-200 shadow-2xl outline-none">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold text-white">Import &amp; export</h2>
          <button onClick={close} aria-label="Close" className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400">✕</button>
        </div>

        <div role="tablist" className="flex gap-1 px-5 pt-4">
          {(['import', 'export'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} disabled={busy} onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 ${tab === t ? 'bg-amber-400/15 text-amber-300' : 'text-slate-400 hover:text-white'}`}>{t}</button>
          ))}
        </div>

        {tab === 'import' ? (
          <div className="space-y-4 p-5">
            <div role="button" tabIndex={0} aria-label="Choose a bookmarks file or drop it here"
              onClick={() => !busy && input.current?.click()}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), !busy && input.current?.click())}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); void choose(e.dataTransfer.files[0]); }}
              className={`flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed px-4 py-8 text-center transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 ${drag ? 'border-amber-400 bg-amber-400/5' : 'border-white/15 hover:border-white/30'} ${busy ? 'pointer-events-none opacity-60' : ''}`}>
              <span className="text-sm font-medium text-white">{file ? file.name : 'Drop your bookmarks file here'}</span>
              <span className="text-xs text-slate-400">Chrome, Firefox, Safari, Edge, Raindrop, Pocket, Pinboard, Instapaper, Notion · HTML, CSV or JSON · up to 10 MB</span>
              <input ref={input} type="file" accept=".html,.htm,.csv,.json,text/html,text/csv,application/json" className="sr-only" tabIndex={-1} onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ''; }} />
            </div>

            {preview && preview.items.length > 0 && phase === 'idle' && (
              <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm" aria-live="polite">
                <p className="text-white">{nf.format(preview.items.length)} bookmarks found</p>
                <p className="text-xs text-slate-400">
                  {FORMAT_LABEL[preview.format]}{preview.sourceGuess ? ` · looks like ${preview.sourceGuess}` : ''}
                  {skippedTotal ? ` · ${nf.format(skippedTotal)} skipped (non-web links or invalid)` : ''}
                </p>
              </div>
            )}

            <div className="flex items-start justify-between gap-4">
              <label htmlFor={aiId} className="cursor-pointer text-sm">
                <span className="font-medium text-white">AI auto-categorization</span>
                <span className="block text-xs text-slate-400">Adds a category, tags, a short summary and a to-do flag. The AI only sees each link's URL, title and domain, not the page, so summaries are best guesses.</span>
              </label>
              <button id={aiId} type="button" role="switch" aria-checked={ai} disabled={busy} onClick={() => setAi(!ai)}
                className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${ai ? 'bg-amber-400' : 'bg-white/20'}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${ai ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
            </div>

            {busy || phase === 'done' ? (
              <div className="space-y-1.5" aria-live="polite">
                <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(phase === 'done' ? 100 : pct)} className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-gradient-to-r from-amber-300 to-amber-500 transition-[width] duration-300" style={{ width: `${phase === 'done' ? 100 : pct}%` }} />
                </div>
                <p className="text-xs text-slate-300">
                  {phase === 'importing' && prog && `Imported ${nf.format(prog.inserted + prog.duplicates)} / ${nf.format(prog.total)} bookmarks…`}
                  {phase === 'enriching' && `Organising with AI… ${nf.format(aiProg?.done ?? 0)} / ${nf.format(aiProg?.total ?? prog?.inserted ?? 0)}`}
                  {phase === 'done' && prog && `Done. ${nf.format(prog.inserted)} added${prog.duplicates ? `, ${nf.format(prog.duplicates)} already in your library` : ''}.`}
                </p>
              </div>
            ) : null}

            {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}

            <div className="flex justify-end gap-2">
              {busy ? <button onClick={() => abort.current?.abort()} className="rounded-lg px-4 py-2 text-sm text-slate-300 hover:bg-white/10">Stop</button>
                : phase === 'done' ? <button onClick={close} className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-[#14213d] hover:bg-amber-300">Close</button>
                : <button onClick={start} disabled={!preview?.items.length} className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-[#14213d] hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40">
                    {preview?.items.length ? `Import ${nf.format(preview.items.length)} bookmarks` : 'Import'}</button>}
            </div>
          </div>
        ) : (
          <div className="space-y-3 p-5">
            <p className="text-sm text-slate-400">Your data is yours. Download everything at any time, no questions asked.</p>
            <a href="/api/export/netscape-html" download className="block rounded-xl border border-white/10 p-4 hover:border-amber-400/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400">
              <span className="block text-sm font-medium text-white">Bookmarks file (HTML)</span>
              <span className="text-xs text-slate-400">Folders, tags, dates and notes. Opens in Chrome, Firefox, Safari, Edge, Raindrop and most others.</span>
            </a>
            <a href="/api/export/json" download className="block rounded-xl border border-white/10 p-4 hover:border-amber-400/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400">
              <span className="block text-sm font-medium text-white">Complete data (JSON)</span>
              <span className="text-xs text-slate-400">Everything above plus categories, AI summaries, to-do items and reminders.</span>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
