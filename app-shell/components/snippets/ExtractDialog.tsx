'use client';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, Check, Globe, Loader2, ShieldAlert, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface Candidate { id: number; title: string; language: string; code: string; lines: number; secret: string | null }
interface Extracted { url: string; title: string; candidates: Candidate[] }
const MSG: Record<string, string> = {
  rate_limited: 'You’ve read a lot of pages this hour. Try again in a bit.', invalid_url: 'That doesn’t look like a web address.', not_html: 'That address isn’t a web page.',
  fetch_failed: 'Couldn’t read that page. It may be private, slow or blocked.', daily_limit: 'Daily snippet limit reached. Try again tomorrow.', vault_full: 'Your snippet vault is full. Delete some first.',
};

/** Paste a link -> Buk reads the page -> pick the code blocks to keep. Nothing is saved until "Save". */
export default function ExtractDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (n: number) => void }) {
  const reduce = useReducedMotion();
  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState<'idle' | 'reading' | 'saving'>('idle');
  const [err, setErr] = useState('');
  const [res, setRes] = useState<Extracted | null>(null);
  const [pick, setPick] = useState<Set<number>>(new Set());
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (!open) return;
    setUrl(''); setRes(null); setErr(''); setPick(new Set()); setPhase('idle');
    const t = setTimeout(() => input.current?.focus(), 50);
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => { clearTimeout(t); window.removeEventListener('keydown', esc); };
  }, [open, onClose]);

  async function read(e: React.FormEvent) {
    e.preventDefault();
    if (busy.current || !url.trim()) return;
    busy.current = true; setPhase('reading'); setErr(''); setRes(null);
    try {
      const r = await fetch('/api/snippets/extract', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}` }) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401) { window.location.href = `/login?next=${encodeURIComponent('/dashboard/snippets')}`; return; }
      if (!r.ok) { setErr(MSG[j.error] ?? j.message ?? 'Something went wrong. Please try again.'); return; }
      setRes(j); setPick(new Set((j.candidates as Candidate[]).filter((c) => !c.secret).map((c) => c.id)));
      if (!j.candidates.length) setErr('No code blocks found on that page.');
    } catch { setErr('Network problem. Please try again.'); } finally { busy.current = false; setPhase('idle'); }
  }

  async function save() {
    if (busy.current || !res || pick.size === 0) return;
    busy.current = true; setPhase('saving'); setErr('');
    try {
      const chosen = res.candidates.filter((c) => pick.has(c.id) && !c.secret);
      const r = await fetch('/api/snippets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceUrl: res.url, sourceTitle: res.title, snippets: chosen.map((c) => ({ code: c.code, language: c.language, title: c.title })) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(MSG[j.error] ?? j.message ?? 'Could not save. Please try again.'); return; }
      onSaved(j.saved ?? 0); onClose();
    } catch { setErr('Network problem. Please try again.'); } finally { busy.current = false; setPhase('idle'); }
  }

  const toggle = (id: number) => setPick((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
          <motion.div role="dialog" aria-modal="true" aria-labelledby="ex-h"
            className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-[#0c1713]/90 text-emerald-50 shadow-2xl backdrop-blur-2xl sm:rounded-3xl"
            initial={reduce ? false : { y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={reduce ? { opacity: 0 } : { y: 24, opacity: 0 }}>
            <header className="flex items-start justify-between gap-3 border-b border-white/10 p-5">
              <div>
                <h2 id="ex-h" className="text-lg font-bold">Extract code from a page</h2>
                <p className="mt-0.5 text-sm text-emerald-100/70">Paste a link. Buk finds the code blocks and you choose what to keep.</p>
              </div>
              <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-emerald-100/70 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400"><X className="h-5 w-5" /></button>
            </header>

            <form onSubmit={read} className="flex gap-2 p-5 pb-3">
              <label className="relative flex-1">
                <span className="sr-only">Page address</span>
                <Globe aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-300/70" />
                <input ref={input} value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" placeholder="https://stackoverflow.com/questions/…" maxLength={2048} autoComplete="off" spellCheck={false}
                  className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-9 pr-3 text-sm placeholder:text-emerald-100/40 focus:border-emerald-400/60 focus:outline-none" />
              </label>
              <button type="submit" disabled={phase !== 'idle' || !url.trim()} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50">
                {phase === 'reading' ? <><Loader2 className="h-4 w-4 animate-spin" />Reading…</> : 'Find code'}
              </button>
            </form>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-2" aria-live="polite">
              {err && <p role="alert" className="mb-3 flex items-start gap-2 rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{err}</p>}
              {res && res.candidates.length > 0 && (
                <>
                  <p className="mb-2 truncate text-xs text-emerald-100/60">{res.title || res.url}</p>
                  <ul className="space-y-2">
                    {res.candidates.map((c) => {
                      const on = pick.has(c.id);
                      return (
                        <li key={c.id}>
                          <label className={`block rounded-2xl border p-3 transition ${c.secret ? 'cursor-not-allowed border-red-400/30 bg-red-400/5' : on ? 'cursor-pointer border-emerald-400/50 bg-emerald-400/10' : 'cursor-pointer border-white/10 bg-white/5 hover:bg-white/[.08]'}`}>
                            <span className="flex items-center gap-3">
                              <input type="checkbox" checked={on} disabled={!!c.secret} onChange={() => toggle(c.id)} className="h-4 w-4 accent-emerald-500" />
                              <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.title}</span>
                              <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-200">{c.language}</span>
                              <span className="shrink-0 text-xs text-emerald-100/50">{c.lines} line{c.lines === 1 ? '' : 's'}</span>
                            </span>
                            {c.secret
                              ? <span className="mt-2 flex items-center gap-2 text-xs text-red-200"><ShieldAlert className="h-4 w-4 shrink-0" />Looks like a real {c.secret}. It can’t be saved.</span>
                              : <pre className="mt-2 max-h-28 overflow-hidden whitespace-pre-wrap break-words rounded-lg bg-black/30 p-2 font-mono text-xs leading-relaxed text-emerald-100/90">{c.code.split('\n').slice(0, 6).join('\n')}{c.lines > 6 ? '\n…' : ''}</pre>}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>

            <footer className="flex items-center justify-between gap-3 border-t border-white/10 p-4">
              <p className="text-xs text-emerald-100/50">Private to you. Secrets are never saved.</p>
              <button type="button" onClick={save} disabled={phase !== 'idle' || pick.size === 0} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40">
                {phase === 'saving' ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</> : <><Check className="h-4 w-4" />Save {pick.size || ''} snippet{pick.size === 1 ? '' : 's'}</>}
              </button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
