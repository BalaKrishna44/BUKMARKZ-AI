'use client';
import { ArrowRight, FileUp, Loader2, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { MAX_IMPORT_BYTES, previewImport, type ImportPreview } from '@/lib/import/summary';
import { savePending } from '@/lib/import/pending';

type S = { s: 'idle' } | { s: 'reading' } | { s: 'error'; msg: string } | { s: 'preview'; p: ImportPreview; file: File };

/** Drop an export file -> parsed entirely in the browser -> preview -> sign in -> confirm import. */
export default function SwitchDropzone({ tool, toolName }: { tool: string; toolName: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [st, setSt] = useState<S>({ s: 'idle' });
  const [over, setOver] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handle(file: File | undefined) {
    if (!file) return;
    if (file.size === 0) return setSt({ s: 'error', msg: 'That file is empty.' });
    if (file.size > MAX_IMPORT_BYTES) return setSt({ s: 'error', msg: `That file is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${MAX_IMPORT_BYTES / 1048576} MB; try exporting one collection at a time.` });
    setSt({ s: 'reading' });
    try {
      await new Promise((r) => setTimeout(r, 30));                  // let the spinner paint before the synchronous parse
      const p = previewImport(await file.text(), file.name);
      if (p.totalCount === 0) {
        return setSt({ s: 'error', msg: p.warnings[0] ?? 'No web links found in that file. Check that it is a bookmarks export (HTML, CSV or JSON).' });
      }
      setSt({ s: 'preview', p, file });
    } catch { setSt({ s: 'error', msg: 'Could not read that file.' }); }
  }
  const reset = () => { setSt({ s: 'idle' }); if (input.current) input.current.value = ''; };      // clearing lets the same file be chosen again

  async function proceed() {
    if (st.s !== 'preview' || saving) return;
    setSaving(true);
    await savePending({ file: st.file, name: st.file.name, source: st.p.source, count: st.p.totalCount });   // false = storage blocked: the resume page asks for the file again
    router.push(`/login?next=${encodeURIComponent('/dashboard/import/resume')}&ref=${encodeURIComponent('switch_' + tool)}`);
  }

  if (st.s === 'preview') {
    const { p } = st, top = p.categories.slice(0, 12), skipped = p.skipped.reduce((n, x) => n + x.count, 0);
    return (
      <div className="space-y-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-6 backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-xl font-bold text-white">{p.totalCount.toLocaleString('en')} links ready</h2>
            <p className="text-xs text-slate-400">{p.source ? `Looks like a ${p.source} export. ` : ''}Read in your browser; nothing has been uploaded.</p>
          </div>
          <button type="button" onClick={reset} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700">Choose a different file</button>
        </div>
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Folders and tags found</h3>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {top.map((c) => <li key={c.name} className="flex items-center justify-between rounded-xl border border-slate-800/80 bg-slate-950/60 p-3 text-xs"><span className="min-w-0 truncate text-slate-300">{c.name}</span><span className="ml-2 font-mono text-slate-500">{c.count}</span></li>)}
          </ul>
          {p.categories.length > top.length && <p className="mt-2 text-xs text-slate-500">+ {p.categories.length - top.length} more</p>}
        </div>
        {(skipped > 0 || p.warnings.length > 0) && <p className="text-xs text-amber-300/90">{skipped > 0 ? `${skipped} item${skipped === 1 ? '' : 's'} can’t be imported (not regular web links). ` : ''}{p.warnings[0] ?? ''}</p>}
        <div className="flex flex-col items-center justify-between gap-4 rounded-xl border border-emerald-500/30 bg-gradient-to-r from-emerald-900/30 to-slate-950 p-6 sm:flex-row">
          <div className="space-y-1 text-center sm:text-left">
            <h3 className="text-base font-bold text-white">Next: create your free account</h3>
            <p className="text-xs text-slate-400">You’ll confirm the import on the next screen. Your file stays on this device until then.</p>
          </div>
          <button type="button" onClick={proceed} disabled={saving} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-950 transition hover:bg-emerald-500 disabled:opacity-60 sm:w-auto">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Continue with {p.totalCount.toLocaleString('en')} links <ArrowRight className="h-4 w-4" /></>}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <label
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void handle(e.dataTransfer.files?.[0]); }}
        className={`group flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center transition-colors focus-within:border-emerald-400 ${over ? 'border-emerald-400 bg-emerald-500/10' : 'border-slate-800 bg-slate-900/30 hover:border-emerald-500/50'}`}>
        <span className="mb-4 rounded-full bg-emerald-500/10 p-4 text-emerald-400 transition-transform group-hover:scale-110">{st.s === 'reading' ? <Loader2 className="h-8 w-8 animate-spin" /> : <FileUp className="h-8 w-8" />}</span>
        <span className="mb-1 text-base font-semibold text-slate-200">{st.s === 'reading' ? 'Reading your file…' : `Drop your ${toolName} export here`}</span>
        <span className="mb-4 text-xs text-slate-500">HTML, CSV or JSON, up to {MAX_IMPORT_BYTES / 1048576} MB</span>
        <span className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-medium text-slate-200 group-hover:bg-slate-700">Browse file</span>
        <input ref={input} type="file" accept=".html,.htm,.csv,.json,text/html,text/csv,application/json" className="sr-only" onChange={(e) => void handle(e.target.files?.[0])} disabled={st.s === 'reading'} />
      </label>
      <p role="status" aria-live="polite" className={st.s === 'error' ? 'rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100' : 'sr-only'}>{st.s === 'error' ? st.msg : ''}</p>
      <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500"><ShieldCheck className="h-4 w-4 text-emerald-500" />Parsed in your browser. Nothing is uploaded until you sign in and confirm.</p>
    </div>
  );
}
