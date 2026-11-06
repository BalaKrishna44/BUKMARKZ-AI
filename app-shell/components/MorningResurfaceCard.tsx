'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

interface Item { id: string; title: string; url: string; host: string; favicon: string | null; opened: boolean; why: string }
interface Quiz { question: string; answer: string; evidence: string | null; result: 'got' | 'missed' | null }
type Data = { paused: boolean; resurface: { id: string; date: string; items: Item[]; quiz: Quiz | null } | null };
type Load = { s: 'loading' } | { s: 'error' } | ({ s: 'ready' } & Data);

const post = (body: unknown) => fetch('/api/resurface/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true });

/** Buk (wise scholar) and Markz (curious sidekick), drawn inline so the widget has no image dependency. */
function Buk({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="Buk, the scholar">
      <ellipse cx="32" cy="42" rx="19" ry="17" fill="#0f6b3e" /><ellipse cx="32" cy="46" rx="11" ry="10" fill="#d4f3e2" />
      <circle cx="32" cy="27" r="17" fill="#1a7f4e" />
      <circle cx="25" cy="27" r="7.5" fill="#fff" /><circle cx="39" cy="27" r="7.5" fill="#fff" />
      <circle cx="25" cy="27.5" r="3.2" fill="#10261c" /><circle cx="39" cy="27.5" r="3.2" fill="#10261c" />
      <circle cx="26" cy="26.4" r="1" fill="#fff" /><circle cx="40" cy="26.4" r="1" fill="#fff" />
      <circle cx="25" cy="27" r="9" fill="none" stroke="#fca311" strokeWidth="1.6" /><circle cx="39" cy="27" r="9" fill="none" stroke="#fca311" strokeWidth="1.6" /><path d="M34 27h-2" stroke="#fca311" strokeWidth="1.6" />
      <path d="M29 34l3 4 3-4z" fill="#fca311" />
      <path d="M13 14l19-8 19 8-19 8z" fill="#10261c" /><path d="M20 19v6c0 3 6 5 12 5s12-2 12-5v-6l-12 5z" fill="#173525" />
      <path d="M51 14v9" stroke="#fca311" strokeWidth="1.6" /><circle cx="51" cy="25" r="2" fill="#fca311" />
    </svg>
  );
}
function Markz({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="Markz, the sidekick">
      <path d="M16 12h32a3 3 0 0 1 3 3v40l-19-11-19 11V15a3 3 0 0 1 3-3z" fill="#fca311" />
      <path d="M22 12h20v14H22z" fill="#ffb938" opacity=".5" />
      <circle cx="25" cy="27" r="6.5" fill="#fff" /><circle cx="39" cy="27" r="6.5" fill="#fff" />
      <circle cx="26.5" cy="28" r="3" fill="#10261c" /><circle cx="40.5" cy="28" r="3" fill="#10261c" />
      <circle cx="27.4" cy="26.8" r="1" fill="#fff" /><circle cx="41.4" cy="26.8" r="1" fill="#fff" />
      <path d="M26 38q6 5 12 0" fill="none" stroke="#10261c" strokeWidth="2" strokeLinecap="round" />
      <path d="M32 12V5" stroke="#fca311" strokeWidth="2" /><circle cx="32" cy="4.5" r="2.5" fill="#fca311" />
    </svg>
  );
}

const glass = 'border border-white/10 bg-white/[0.06] backdrop-blur-xl shadow-[0_8px_40px_rgba(0,0,0,.35),inset_0_1px_0_rgba(255,255,255,.08)]';
const btn = 'rounded-lg px-3 py-1.5 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';

export default function MorningResurfaceCard({ className = '' }: { className?: string }) {
  const [st, setSt] = useState<Load>({ s: 'loading' });
  const [shelved, setShelved] = useState<Set<string>>(new Set());
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [reveal, setReveal] = useState(false);
  const [result, setResult] = useState<'got' | 'missed' | null>(null);
  const [err, setErr] = useState('');
  const live = useRef<HTMLParagraphElement>(null);

  const load = useCallback(async () => {
    setSt({ s: 'loading' });
    try {
      const r = await fetch('/api/resurface', { cache: 'no-store' });
      if (r.status === 401) { window.location.href = '/login?next=/dashboard'; return; }
      if (!r.ok) throw new Error('load');
      const d: Data = await r.json();
      setSt({ s: 'ready', ...d }); setResult(d.resurface?.quiz?.result ?? null);
      setOpened(new Set(d.resurface?.items.filter((i) => i.opened).map((i) => i.id)));
    } catch { setSt({ s: 'error' }); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (action: 'open' | 'archive' | 'restore', id: string) => {
    setErr('');
    if (action === 'open') setOpened((s) => new Set(s).add(id));
    if (action === 'archive') setShelved((s) => new Set(s).add(id));
    if (action === 'restore') setShelved((s) => { const n = new Set(s); n.delete(id); return n; });
    try { const r = await post({ action, itemId: id }); if (!r.ok && r.status !== 404) throw new Error('save'); }
    catch {
      setErr(action === 'open' ? '' : 'Couldn’t save that. Try again.');                      // an open still worked in the new tab; only archive/restore need to roll back
      if (action === 'archive') setShelved((s) => { const n = new Set(s); n.delete(id); return n; });
      if (action === 'restore') setShelved((s) => new Set(s).add(id));
    }
  };
  const rate = async (r: 'got' | 'missed') => {
    if (st.s !== 'ready' || !st.resurface) return;
    setResult(r);
    try { const res = await post({ action: 'quiz', resurfaceId: st.resurface.id, result: r }); if (!res.ok) throw new Error('save'); } catch { /* a missed stat is not worth interrupting the user */ }
  };

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  if (st.s === 'loading') return <div className={`${glass} h-72 animate-pulse rounded-3xl ${className}`} aria-label="Loading your morning picks" />;
  if (st.s === 'error') return (
    <section className={`${glass} rounded-3xl p-6 text-emerald-50 ${className}`}><p>Buk couldn’t fetch today’s picks.</p>
      <button onClick={load} className={`${btn} mt-3 bg-emerald-400/90 text-emerald-950 hover:bg-emerald-300 focus-visible:outline-emerald-200`}>Retry</button></section>
  );
  if (st.paused) return (
    <section className={`${glass} flex items-center justify-between gap-4 rounded-3xl p-5 text-emerald-100/80 ${className}`}><span>Morning Resurface is paused.</span>
      <button onClick={async () => { await post({ action: 'resume' }); void load(); }} className={`${btn} border border-emerald-400/30 bg-emerald-400/10 hover:bg-emerald-400/20 focus-visible:outline-emerald-300`}>Turn on</button></section>
  );
  const r = st.resurface;
  if (!r || r.items.length === 0) return (
    <section className={`${glass} flex items-center gap-4 rounded-3xl p-5 text-emerald-100/80 ${className}`}><Buk className="h-14 w-14 shrink-0" />
      <p>Nothing to resurface yet. Buk looks for links you saved over a week ago, so check back after a few more saves.</p></section>
  );

  const visible = r.items;                                   // archived rows stay visible (struck through) so Undo works
  const handled = r.items.filter((i) => opened.has(i.id) || shelved.has(i.id)).length;
  const allDone = handled === r.items.length;

  return (
    <section aria-labelledby="mr-h" className={`relative overflow-hidden rounded-3xl text-emerald-50 ${glass} ${className}`}>
      <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-emerald-500/20 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-24 -right-16 h-60 w-60 rounded-full bg-amber-400/10 blur-3xl" />
      <div className="relative p-5 sm:p-7">
        {/* mascots + speech */}
        <header className="flex items-start gap-3">
          <div className="flex shrink-0 items-end"><Buk className="h-14 w-14 sm:h-16 sm:w-16" /><Markz className="-ml-2 h-10 w-10 sm:h-12 sm:w-12" /></div>
          <div className="min-w-0 flex-1">
            <h2 id="mr-h" className="text-lg font-bold leading-tight sm:text-xl">{greet}. Buk found {r.items.length} forgotten saves.</h2>
            <p className="mt-1 text-sm text-amber-100/80">{allDone ? 'MARKZ: ALL DONE!! The pile is smaller!! Quiz time?!' : 'MARKZ: OOH OOH remember these?? Open one, or send it to the archive!!'}</p>
          </div>
          <div className="shrink-0 text-right text-xs text-emerald-200/70" aria-label={`${handled} of ${r.items.length} handled`}>
            <span className="text-base font-semibold text-emerald-50">{handled}</span>/{r.items.length}
            <div className="mt-1 h-1 w-14 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-amber-300 transition-all duration-500" style={{ width: `${(handled / r.items.length) * 100}%` }} /></div>
          </div>
        </header>

        {err && <p role="alert" className="mt-3 rounded-lg bg-rose-500/15 px-3 py-2 text-sm text-rose-100">{err}</p>}
        <p ref={live} className="sr-only" aria-live="polite">{handled} of {r.items.length} handled</p>

        {/* the five links */}
        <ul className="mt-5 space-y-2">
          {visible.map((it, i) => {
            const gone = shelved.has(it.id), seen = opened.has(it.id);
            return (
              <li key={it.id} className={`group flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3 transition-all duration-300 ${gone ? 'opacity-50' : 'hover:border-emerald-400/40 hover:bg-white/[0.07]'}`} style={{ animation: `mr-in .4s ease ${i * 60}ms both` }}>
                <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-xl bg-emerald-400/10 text-sm font-bold text-emerald-200">
                  {it.favicon ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={it.favicon} alt="" width={20} height={20} loading="lazy" referrerPolicy="no-referrer" className="h-5 w-5" /> : (it.host[0] ?? '•').toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`truncate font-medium ${gone ? 'line-through' : ''}`}>{it.title}</p>
                  <p className="truncate text-xs text-emerald-200/60">{it.host}{it.why ? ` · ${it.why}` : ''}</p>
                </div>
                {gone ? (
                  <button onClick={() => act('restore', it.id)} className={`${btn} text-emerald-200 hover:bg-white/10 focus-visible:outline-emerald-300`}>Undo</button>
                ) : (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <a href={it.url} target="_blank" rel="noopener noreferrer" onClick={() => act('open', it.id)} aria-label={`Open ${it.title}`}
                      className={`${btn} ${seen ? 'bg-emerald-400/15 text-emerald-200' : 'bg-emerald-400/90 text-emerald-950 hover:bg-emerald-300'} focus-visible:outline-emerald-200`}>{seen ? '✓ Opened' : 'Open'}</a>
                    <button onClick={() => act('archive', it.id)} aria-label={`Archive ${it.title}`} className={`${btn} border border-white/15 text-emerald-100 hover:bg-white/10 focus-visible:outline-white`}>Archive</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {/* recall quiz */}
        {r.quiz && (
          <div className="mt-5 rounded-2xl border border-amber-300/20 bg-gradient-to-br from-amber-400/10 to-transparent p-4 sm:p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-200/90">Markz’s recall challenge</p>
            <p className="mt-2 text-balance text-base font-semibold leading-snug sm:text-lg">{r.quiz.question}</p>
            {!reveal ? (
              <button onClick={() => setReveal(true)} aria-expanded={false} className={`${btn} mt-3 bg-amber-300 text-amber-950 hover:bg-amber-200 focus-visible:outline-amber-100`}>Reveal answer</button>
            ) : (
              <div aria-live="polite" style={{ animation: 'mr-in .35s ease both' }}>
                <p className="mt-3 rounded-xl bg-white/[0.07] p-3 text-emerald-50">{r.quiz.answer}</p>
                {r.quiz.evidence && <blockquote className="mt-2 border-l-2 border-amber-300/40 pl-3 text-sm italic text-emerald-100/70">“{r.quiz.evidence}”</blockquote>}
                <div className="mt-3 flex items-center gap-2">
                  {result ? <p className="text-sm text-amber-100/90">{result === 'got' ? 'BUK: Well recalled.' : 'BUK: Then it was worth resurfacing.'}</p> : (<>
                    <span className="text-sm text-emerald-200/70">Did you remember?</span>
                    <button onClick={() => rate('got')} className={`${btn} bg-emerald-400/90 text-emerald-950 hover:bg-emerald-300 focus-visible:outline-emerald-200`}>Got it</button>
                    <button onClick={() => rate('missed')} className={`${btn} border border-white/15 hover:bg-white/10 focus-visible:outline-white`}>Missed it</button></>)}
                </div>
              </div>
            )}
          </div>
        )}

        <footer className="mt-4 flex justify-end">
          <button onClick={async () => { await post({ action: 'pause' }); void load(); }} className="rounded px-2 py-1 text-xs text-emerald-200/50 hover:text-emerald-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300">Pause morning picks</button>
        </footer>
      </div>
      <style>{`@keyframes mr-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}`}</style>
    </section>
  );
}
