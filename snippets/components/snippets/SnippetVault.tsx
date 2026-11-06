'use client';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, ChevronDown, Code2, Copy, ExternalLink, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import ExtractDialog from './ExtractDialog';

interface Snippet { id: string; title: string; language: string; code: string; source_url: string | null; source_title: string | null; note: string | null; created_at: string }
interface Lang { language: string; count: number }
const glass = 'border border-white/10 bg-white/[.06] backdrop-blur-xl';
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const safeHref = (u: string | null) => (u && /^https?:\/\//i.test(u) ? u : null);       // stored data is never trusted to be a safe href

function Buk({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="Buk, the scholar">
      <ellipse cx="32" cy="42" rx="19" ry="17" fill="#0f6b3e" /><ellipse cx="32" cy="46" rx="11" ry="10" fill="#d4f3e2" /><circle cx="32" cy="27" r="17" fill="#1a7f4e" />
      <circle cx="25" cy="27" r="7.5" fill="#fff" /><circle cx="39" cy="27" r="7.5" fill="#fff" /><circle cx="25" cy="27.5" r="3.2" fill="#10261c" /><circle cx="39" cy="27.5" r="3.2" fill="#10261c" />
      <circle cx="25" cy="27" r="9" fill="none" stroke="#fca311" strokeWidth="1.6" /><circle cx="39" cy="27" r="9" fill="none" stroke="#fca311" strokeWidth="1.6" /><path d="M29 34l3 4 3-4z" fill="#fca311" />
      <path d="M13 14l19-8 19 8-19 8z" fill="#10261c" /><path d="M51 14v9" stroke="#fca311" strokeWidth="1.6" /><circle cx="51" cy="25" r="2" fill="#fca311" />
    </svg>
  );
}

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  try {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch { return false; }
}

function Card({ s, onDelete, reduce }: { s: Snippet; onDelete: (id: string) => Promise<void>; reduce: boolean | null }) {
  const [open, setOpen] = useState(false), [copied, setCopied] = useState(false), [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false);
  const lines = s.code.split('\n').length, long = lines > 12;
  const shown = long && !open ? s.code.split('\n').slice(0, 12).join('\n') : s.code;
  const href = safeHref(s.source_url);
  return (
    <motion.li layout={!reduce} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98 }} className={`${glass} overflow-hidden rounded-2xl`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3.5">
        <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-emerald-50">{s.title}</h3>
        <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-300">{s.language}</span>
        <span className="text-xs text-emerald-100/50">{lines} line{lines === 1 ? '' : 's'}</span>
      </div>
      <div className="relative mt-2.5 px-4">
        <pre tabIndex={0} aria-label={`${s.language} code`} className="max-h-[28rem] overflow-auto rounded-xl bg-black/40 p-3 pr-12 font-mono text-[13px] leading-relaxed text-emerald-100">{shown}{long && !open ? '\n…' : ''}</pre>
        <button type="button" onClick={async () => { if (await copyText(s.code)) { setCopied(true); setTimeout(() => setCopied(false), 1600); } }} aria-label={copied ? 'Copied' : 'Copy code'}
          className="absolute right-6 top-2 rounded-lg bg-white/10 p-1.5 text-emerald-100 transition hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400">
          {copied ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
      {long && <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="mx-4 mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-emerald-300 hover:underline"><ChevronDown className={`h-3.5 w-3.5 transition ${open ? 'rotate-180' : ''}`} />{open ? 'Show less' : `Show all ${lines} lines`}</button>}
      {s.note && <p className="mx-4 mt-2 text-sm text-emerald-100/80 [overflow-wrap:anywhere]">{s.note}</p>}
      <div className="mt-3 flex items-center gap-3 border-t border-white/10 px-4 py-2.5 text-xs text-emerald-100/55">
        {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1 truncate hover:text-emerald-300"><ExternalLink className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{s.source_title || host(href)}</span></a> : <span>Saved by hand</span>}
        <time className="ml-auto shrink-0" dateTime={s.created_at}>{new Date(s.created_at).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}</time>
        {confirm ? (
          <span className="flex items-center gap-1.5">
            <button type="button" disabled={busy} onClick={async () => { setBusy(true); await onDelete(s.id); setBusy(false); }} className="rounded-md bg-red-500/80 px-2 py-1 font-semibold text-white hover:bg-red-500 disabled:opacity-50">{busy ? '…' : 'Delete'}</button>
            <button type="button" onClick={() => setConfirm(false)} className="rounded-md px-2 py-1 hover:bg-white/10">Keep</button>
          </span>
        ) : <button type="button" onClick={() => setConfirm(true)} aria-label={`Delete ${s.title}`} className="rounded-md p-1 hover:bg-white/10 hover:text-red-300"><Trash2 className="h-4 w-4" /></button>}
      </div>
    </motion.li>
  );
}

/** The Snippet Vault: search, filter by language, copy, delete, and extract from a link. */
export default function SnippetVault() {
  const reduce = useReducedMotion();
  const [items, setItems] = useState<Snippet[]>([]);
  const [langs, setLangs] = useState<Lang[]>([]);
  const [q, setQ] = useState(''), [dq, setDq] = useState('');
  const [lang, setLang] = useState<string | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [more, setMore] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [toast, setToast] = useState('');
  const ctl = useRef<AbortController | null>(null);

  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const load = useCallback(async (before?: string) => {
    ctl.current?.abort(); const c = new AbortController(); ctl.current = c;
    const p = new URLSearchParams({ limit: '20' });
    if (dq) p.set('q', dq); if (lang) p.set('lang', lang); if (before) p.set('before', before);
    try {
      const r = await fetch(`/api/snippets?${p}`, { signal: c.signal, cache: 'no-store' });
      if (r.status === 401) { window.location.href = `/login?next=${encodeURIComponent('/dashboard/snippets')}`; return; }
      if (!r.ok) throw new Error();
      const j = await r.json();
      setItems((cur) => (before ? [...cur, ...j.snippets] : j.snippets)); setNext(j.next);
      if (j.languages) setLangs(j.languages);
      setState('ready');
    } catch (e) { if ((e as Error).name !== 'AbortError') setState('error'); } finally { if (!c.signal.aborted) setMore(false); }
  }, [dq, lang]);

  useEffect(() => { setState((s) => (s === 'ready' ? s : 'loading')); void load(); return () => ctl.current?.abort(); }, [load]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t); }, [toast]);

  async function del(id: string) {
    const r = await fetch(`/api/snippets/${id}`, { method: 'DELETE', headers: { 'content-type': 'application/json' } });
    if (r.ok) { setItems((cur) => cur.filter((s) => s.id !== id)); setToast('Snippet deleted.'); void load(); } else setToast('Could not delete. Please try again.');
  }

  const filtered = !!dq || !!lang;
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 text-emerald-50 sm:py-10">
      <header className="flex flex-wrap items-center gap-4">
        <Buk className="h-14 w-14 shrink-0" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Snippet Vault</h1>
          <p className="text-sm text-emerald-100/65">Code you found once, ready to copy again.</p>
        </div>
        <button type="button" onClick={() => setDialog(true)} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-emerald-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300">
          <Plus className="h-4 w-4" />Extract from a link
        </button>
      </header>

      <div className="mt-6 space-y-3">
        <label className={`${glass} flex items-center gap-2 rounded-2xl px-4 py-2.5 focus-within:border-emerald-400/50`}>
          <Search aria-hidden className="h-4 w-4 text-emerald-300/70" />
          <span className="sr-only">Search snippets</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={200} placeholder="Search code, titles, notes…  (try “useEffect cleanup” or -deprecated)" className="w-full bg-transparent text-sm placeholder:text-emerald-100/40 focus:outline-none" />
        </label>
        {langs.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by language">
            <button type="button" onClick={() => setLang(null)} aria-pressed={!lang} className={`rounded-full px-3 py-1 text-xs font-semibold transition ${!lang ? 'bg-emerald-400 text-emerald-950' : 'bg-white/10 text-emerald-100 hover:bg-white/15'}`}>All</button>
            {langs.map((l) => <button key={l.language} type="button" onClick={() => setLang(lang === l.language ? null : l.language)} aria-pressed={lang === l.language} className={`rounded-full px-3 py-1 text-xs font-semibold transition ${lang === l.language ? 'bg-emerald-400 text-emerald-950' : 'bg-white/10 text-emerald-100 hover:bg-white/15'}`}>{l.language} <span className="opacity-60">{l.count}</span></button>)}
          </div>
        )}
      </div>

      <section className="mt-5" aria-live="polite" aria-busy={state === 'loading'}>
        {state === 'loading' && <div className="space-y-3" aria-label="Loading snippets">{[0, 1, 2].map((i) => <div key={i} className={`${glass} h-40 animate-pulse rounded-2xl`} />)}</div>}
        {state === 'error' && <div role="alert" className={`${glass} rounded-2xl p-6 text-center`}><p>Buk couldn’t load your snippets.</p><button type="button" onClick={() => { setState('loading'); void load(); }} className="mt-3 rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20">Try again</button></div>}
        {state === 'ready' && items.length === 0 && (
          <div className={`${glass} flex flex-col items-center gap-3 rounded-3xl p-8 text-center`}>
            <Code2 aria-hidden className="h-8 w-8 text-emerald-300" />
            <p className="max-w-sm text-emerald-100/80">{filtered ? 'No snippets match. Try other words or clear the language filter.' : 'Nothing here yet. Paste a link to an article and Buk will pull out the code. In the browser extension, right-click any code and choose “Save Selection as Code Snippet”.'}</p>
            {filtered ? <button type="button" onClick={() => { setQ(''); setLang(null); }} className="rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20">Clear filters</button> : <button type="button" onClick={() => setDialog(true)} className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400">Extract from a link</button>}
          </div>
        )}
        {state === 'ready' && items.length > 0 && (
          <>
            <ul className="space-y-3"><AnimatePresence initial={false}>{items.map((s) => <Card key={s.id} s={s} onDelete={del} reduce={reduce} />)}</AnimatePresence></ul>
            {next && <div className="mt-5 text-center"><button type="button" disabled={more} onClick={() => { setMore(true); void load(next); }} className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm hover:bg-white/15 disabled:opacity-60">{more && <Loader2 className="h-4 w-4 animate-spin" />}Load more</button></div>}
          </>
        )}
      </section>

      <p role="status" aria-live="polite" className={`fixed bottom-4 left-1/2 -translate-x-1/2 rounded-xl border border-white/10 bg-[#0c1713]/95 px-4 py-2 text-sm shadow-xl backdrop-blur transition ${toast ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>{toast}</p>
      <ExtractDialog open={dialog} onClose={() => setDialog(false)} onSaved={(n) => { setToast(n ? `Saved ${n} snippet${n === 1 ? '' : 's'}.` : 'Those were already in your vault.'); void load(); }} />
    </div>
  );
}
