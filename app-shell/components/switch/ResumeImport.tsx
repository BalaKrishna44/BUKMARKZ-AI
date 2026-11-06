'use client';
import { CheckCircle2, Loader2, Upload } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { clearPending, loadPending, type PendingImport } from '@/lib/import/pending';
import { SseParser } from '@/lib/import/sse';
import { MAX_IMPORT_BYTES } from '@/lib/import/summary';

type S = { s: 'loading' } | { s: 'none' } | { s: 'ready'; p: Pick<PendingImport, 'file' | 'name' | 'count'> } | { s: 'running'; done: number; total: number } | { s: 'done'; inserted: number; duplicates: number } | { s: 'error'; msg: string };

/** After signup: the file saved on /switch is imported only when the user presses the button. Progress comes from the SSE stream of POST /api/import. */
export default function ResumeImport() {
  const [st, setSt] = useState<S>({ s: 'loading' });
  const [ai, setAi] = useState(true);
  const busy = useRef(false);

  useEffect(() => { let alive = true; loadPending().then((p) => { if (alive) setSt(p ? { s: 'ready', p } : { s: 'none' }); }); return () => { alive = false; }; }, []);

  async function run(file: Blob, name: string) {
    if (busy.current) return;
    busy.current = true; setSt({ s: 'running', done: 0, total: 0 });
    try {
      const fd = new FormData(); fd.append('file', file, name); fd.append('ai', String(ai));
      const res = await fetch('/api/import', { method: 'POST', body: fd });
      if (res.status === 401) { window.location.href = `/login?next=${encodeURIComponent('/dashboard/import/resume')}`; return; }
      if (!res.ok || !res.body) { const j = await res.json().catch(() => ({})); return setSt({ s: 'error', msg: j.error ?? 'The import could not start.' }); }
      const reader = res.body.getReader(), dec = new TextDecoder(), sse = new SseParser();
      let finished = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const ev of sse.push(dec.decode(value, { stream: true }))) {
          if (ev.event === 'progress' || ev.event === 'parsed') setSt({ s: 'running', done: ev.data.processed ?? 0, total: ev.data.total ?? 0 });
          else if (ev.event === 'done') { finished = true; await clearPending(); setSt({ s: 'done', inserted: ev.data.inserted ?? 0, duplicates: ev.data.duplicates ?? 0 }); }
          else if (ev.event === 'error') { finished = true; setSt({ s: 'error', msg: ev.data.message ?? 'The import failed part-way. Run it again to finish; links already imported are skipped.' }); }
        }
      }
      if (!finished) setSt({ s: 'error', msg: 'The connection dropped part-way. Run it again to finish; links already imported are skipped.' });
    } catch { setSt({ s: 'error', msg: 'Network problem. Run it again to finish; links already imported are skipped.' }); } finally { busy.current = false; }
  }

  const card = 'mx-auto w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-900/80 p-6 text-slate-100 backdrop-blur-md';
  if (st.s === 'loading') return <div className={card} aria-busy="true"><Loader2 className="mx-auto h-6 w-6 animate-spin text-emerald-400" /></div>;
  if (st.s === 'none') return (
    <div className={`${card} space-y-4 text-center`}>
      <h1 className="text-xl font-bold">Choose a file to import</h1>
      <p className="text-sm text-slate-400">We didn’t find a file waiting from the previous step (browsers can clear it). Pick it again below.</p>
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white focus-within:outline focus-within:outline-2 focus-within:outline-emerald-300 hover:bg-emerald-500">
        <Upload className="h-4 w-4" />Browse file
        <input type="file" accept=".html,.htm,.csv,.json" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; if (f.size > MAX_IMPORT_BYTES) return setSt({ s: 'error', msg: `That file is over ${MAX_IMPORT_BYTES / 1048576} MB.` }); setSt({ s: 'ready', p: { file: f, name: f.name, count: 0 } }); }} />
      </label>
    </div>
  );
  if (st.s === 'ready') return (
    <div className={`${card} space-y-4`}>
      <h1 className="text-xl font-bold">Import {st.p.count ? `${st.p.count.toLocaleString('en')} links` : 'your links'}?</h1>
      <p className="truncate text-sm text-slate-400">From <span className="text-slate-200">{st.p.name}</span>. Links you already have are skipped.</p>
      <label className="flex items-start gap-3 text-sm text-slate-300"><input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} className="mt-0.5 h-4 w-4 accent-emerald-500" /><span>Sort them with AI (adds tags and a summary in the background). Private browsing items are never sent.</span></label>
      <button type="button" onClick={() => run(st.p.file, st.p.name)} className="w-full rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300">Start import</button>
    </div>
  );
  if (st.s === 'running') {
    const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
    return (
      <div className={`${card} space-y-3`} role="status" aria-live="polite">
        <h1 className="text-xl font-bold">Importing…</h1>
        <div className="h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} /></div>
        <p className="text-xs text-slate-400">{st.total ? `${st.done.toLocaleString('en')} of ${st.total.toLocaleString('en')}` : 'Reading your file…'}. Keep this tab open.</p>
      </div>
    );
  }
  if (st.s === 'done') return (
    <div className={`${card} space-y-4 text-center`}>
      <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" aria-hidden />
      <h1 className="text-xl font-bold">{st.inserted.toLocaleString('en')} links imported</h1>
      {st.duplicates > 0 && <p className="text-sm text-slate-400">{st.duplicates.toLocaleString('en')} were already in your vault.</p>}
      <Link href="/dashboard" className="inline-block rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500">Open my vault</Link>
    </div>
  );
  return (
    <div className={`${card} space-y-3`} role="alert">
      <h1 className="text-xl font-bold">Import problem</h1>
      <p className="text-sm text-amber-100">{st.msg}</p>
      <button type="button" onClick={() => setSt({ s: 'loading' })} className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700">Back</button>
    </div>
  );
}
