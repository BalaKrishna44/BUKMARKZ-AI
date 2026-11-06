'use client';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ExternalLink, Loader2, MessageCircleQuestion, Search, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { focusRing, panel } from '@/lib/ui';

export type SearchMode = 'search' | 'ask';
export interface AskResult { answer: string; sources: { id: string; title: string; host: string; url: string }[] }
export interface SearchState { query: string; mode: SearchMode; filters: string[] }

interface Props {
  filterOptions: readonly string[];
  /** Called after every change to the query, mode or filters (in Ask mode the query is reported as empty so the feed isn't filtered while typing).
   *  Pass a stable function (a state setter or useCallback), otherwise the effect that calls it re-runs on every render. */
  onChange?: (s: SearchState) => void;
  /** Ask Your Vault. Reject to show the error state. If omitted, the Ask toggle is hidden. */
  ask?: (query: string) => Promise<AskResult>;
  className?: string;
}

/** Search bar with an "Ask Your Vault" mode, a Cmd/Ctrl+K shortcut and filter chips. */
export default function HeaderSearch({ filterOptions, onChange, ask, className = '' }: Props) {
  const reduce = useReducedMotion();
  const inputRef = useRef<HTMLInputElement>(null), seq = useRef(0), panelId = useId();
  const [mode, setMode] = useState<SearchMode>('search'), [query, setQuery] = useState(''), [filters, setFilters] = useState<string[]>([]);
  const [state, setState] = useState<{ s: 'idle' } | { s: 'loading' } | { s: 'done'; q: string; r: AskResult } | { s: 'error' }>({ s: 'idle' });
  const [hint, setHint] = useState('Ctrl K');                         // decided after mount so server and client HTML match

  useEffect(() => { setHint(/Mac|iPhone|iPad/i.test(navigator.userAgent) ? '⌘ K' : 'Ctrl K'); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); inputRef.current?.focus(); inputRef.current?.select(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { onChange?.({ query: mode === 'search' ? query : '', mode, filters }); }, [query, mode, filters, onChange]);   // Ask mode never filters the feed while typing

  const clearAnswer = useCallback(() => { seq.current++; setState({ s: 'idle' }); }, []);
  const switchMode = (m: SearchMode) => { setMode(m); clearAnswer(); inputRef.current?.focus(); };
  const toggle = (f: string) => setFilters((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (mode !== 'ask' || !ask || !q) return;
    const my = ++seq.current;
    setState({ s: 'loading' });
    try { const r = await ask(q); if (my === seq.current) setState({ s: 'done', q, r }); } catch { if (my === seq.current) setState({ s: 'error' }); }
  }

  const asking = mode === 'ask';
  return (
    <div className={className}>
      <form role="search" onSubmit={submit} className={`${panel} flex items-center gap-2 rounded-2xl p-2 transition focus-within:border-emerald-500/60 focus-within:shadow-[0_0_0_4px_rgba(16,185,129,.12)]`}>
        {ask && (
          <div role="group" aria-label="Search mode" className="flex shrink-0 rounded-xl bg-slate-950/70 p-0.5">
            {([['search', 'Search', Search], ['ask', 'Ask', Sparkles]] as const).map(([m, label, Icon]) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => switchMode(m)} className={`flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-xs font-semibold transition sm:px-3 ${mode === m ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-white'} ${focusRing}`}>
                <Icon className="h-3.5 w-3.5" aria-hidden /><span>{label}</span>
              </button>
            ))}
          </div>
        )}
        <label className="flex min-w-0 flex-1 items-center gap-2 px-1">
          {asking ? <MessageCircleQuestion className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden /> : <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />}
          <span className="sr-only">{asking ? 'Ask your vault a question' : 'Search your bookmarks'}</span>
          <input ref={inputRef} value={query} onChange={(e) => { setQuery(e.target.value); if (state.s !== 'idle') clearAnswer(); }} onKeyDown={(e) => { if (e.key === 'Escape') { if (state.s !== 'idle') clearAnswer(); else if (query) setQuery(''); else inputRef.current?.blur(); } }}
            maxLength={300} autoComplete="off" spellCheck={false} aria-controls={panelId}
            placeholder={asking ? 'Ask anything you’ve saved… “What was that article about HNSW?”' : 'Search titles, tags and notes'}
            className="w-full min-w-0 bg-transparent py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500" />
        </label>
        {query && <button type="button" onClick={() => { setQuery(''); clearAnswer(); inputRef.current?.focus(); }} aria-label="Clear" className={`rounded-lg p-1.5 text-slate-400 hover:text-white ${focusRing}`}><X className="h-4 w-4" aria-hidden /></button>}
        {asking ? <button type="submit" disabled={!query.trim() || state.s === 'loading'} className={`shrink-0 rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50 ${focusRing}`}>{state.s === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Asking" /> : 'Ask'}</button>
          : <kbd className="hidden shrink-0 rounded-md border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-400 sm:block" aria-hidden>{hint}</kbd>}
      </form>

      {filterOptions.length > 0 && (
        <div role="group" aria-label="Filters" className="mt-3 flex flex-wrap gap-2">
          {filterOptions.map((f) => <button key={f} type="button" aria-pressed={filters.includes(f)} onClick={() => toggle(f)} className={`rounded-full border px-3 py-1 text-xs font-medium transition ${filters.includes(f) ? 'border-emerald-400 bg-emerald-500/15 text-emerald-300' : 'border-slate-700 bg-slate-900/50 text-slate-300 hover:border-slate-600'} ${focusRing}`}>{f}</button>)}
          {filters.length > 0 && <button type="button" onClick={() => setFilters([])} className={`px-2 text-xs text-slate-500 hover:text-slate-300 ${focusRing}`}>Clear filters</button>}
        </div>
      )}

      <div id={panelId} aria-live="polite">
        <AnimatePresence initial={false}>
          {state.s === 'done' && (
            <motion.section key="answer" aria-label="Answer from your vault" initial={reduce ? false : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0 }} transition={{ duration: 0.2 }} className={`${panel} mt-3 rounded-2xl border-emerald-500/20 p-4`}>
              <div className="mb-1.5 flex items-start justify-between gap-3"><p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">Buk’s answer</p><button type="button" onClick={clearAnswer} aria-label="Dismiss answer" className={`rounded p-0.5 text-slate-500 hover:text-white ${focusRing}`}><X className="h-4 w-4" aria-hidden /></button></div>
              <p className="text-sm leading-relaxed text-slate-200">{state.r.answer}</p>
              {state.r.sources.length > 0 && <ul className="mt-3 flex flex-wrap gap-2">{state.r.sources.map((s) => <li key={s.id}><a href={s.url} target="_blank" rel="noopener noreferrer" className={`inline-flex max-w-full items-center gap-1 rounded-full border border-slate-700 bg-slate-950/60 px-2.5 py-1 text-xs text-slate-300 hover:border-emerald-500/50 hover:text-white ${focusRing}`}><span className="truncate">{s.title}</span><ExternalLink className="h-3 w-3 shrink-0 text-emerald-400" aria-hidden /></a></li>)}</ul>}
            </motion.section>
          )}
          {state.s === 'error' && <motion.p key="err" role="alert" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">Couldn’t reach Buk just now. Your question is still in the box, so try again.</motion.p>}
        </AnimatePresence>
      </div>
    </div>
  );
}
