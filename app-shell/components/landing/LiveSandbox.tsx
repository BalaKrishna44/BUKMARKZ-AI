'use client';
import { ArrowRight, ExternalLink, Loader2, Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { LINKS, SANDBOX_IDS, SANDBOX_SUGGESTIONS, hostOf } from '@/lib/demo/data';
import { answerFromVault, type Answer } from '@/lib/demo/sandbox';
import { btnPrimary, focusRing, panel } from '@/lib/ui';

const VAULT = LINKS.filter((l) => SANDBOX_IDS.includes(l.id));

/** Try Ask Your Vault on a made-up vault of 8 links. Runs entirely in the browser: nothing is sent anywhere, no account needed. */
export default function LiveSandbox() {
  const [q, setQ] = useState(''), [res, setRes] = useState<{ q: string; a: Answer } | null>(null), [busy, setBusy] = useState(false);
  const run = useRef(0);
  const used = useMemo(() => new Set(res?.a.sources.map((s) => s.id)), [res]);

  function ask(text: string) {
    const t = text.trim().slice(0, 200);
    if (!t) return;
    const my = ++run.current; setQ(t); setBusy(true);
    setTimeout(() => { if (my !== run.current) return; setRes({ q: t, a: answerFromVault(t, VAULT) }); setBusy(false); }, 350);         // a beat, so the answer feels considered
  }

  return (
    <div className={`${panel} rounded-2xl p-4 sm:p-6`}>
      <form onSubmit={(e) => { e.preventDefault(); ask(q); }} role="search" className="flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-1 items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 focus-within:border-emerald-400">
          <Search className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden /><span className="sr-only">Ask the demo vault a question</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={200} placeholder="Ask about vectors, row security, CSV, extensions…" className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500" />
        </label>
        <button type="submit" className={btnPrimary} disabled={busy || !q.trim()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : 'Ask Buk'}</button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Example questions">
        {SANDBOX_SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => ask(s)} className={`rounded-full border border-slate-700 bg-slate-950/50 px-3 py-1 text-xs text-slate-300 transition hover:border-emerald-500/50 hover:text-white ${focusRing}`}>{s}</button>)}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3" role="status" aria-live="polite">
          {res ? (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">Answer</p>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-200">{res.a.answer}</p>
              {res.a.sources.length > 0 && <ul className="mt-3 space-y-1.5">{res.a.sources.map((s) => <li key={s.id}><a href={s.url} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1.5 text-xs text-emerald-300 hover:underline ${focusRing}`}>{s.title}<ExternalLink className="h-3 w-3" aria-hidden /><span className="text-slate-500">{s.host}</span></a></li>)}</ul>}
            </div>
          ) : <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">Pick an example or type your own question. Answers use only the eight links on the right.</p>}
        </div>
        <div className="lg:col-span-2">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Demo vault · {VAULT.length} links</p>
          <ul className="space-y-1.5">{VAULT.map((l) => <li key={l.id} className={`truncate rounded-lg border px-2.5 py-1.5 text-xs transition ${used.has(l.id) ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200' : 'border-slate-800 bg-slate-950/40 text-slate-400'}`} title={l.title}>{l.title}<span className="ml-1.5 text-slate-600">{hostOf(l.url)}</span></li>)}</ul>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 border-t border-slate-800 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-relaxed text-slate-500">This demo matches keywords in your browser. The real Ask Your Vault searches by meaning with embeddings and writes the answer with AI.</p>
        <Link href="/switch/raindrop" className={`inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-emerald-400 hover:text-emerald-300 ${focusRing}`}>Import your own links <ArrowRight className="h-4 w-4" aria-hidden /></Link>
      </div>
    </div>
  );
}
