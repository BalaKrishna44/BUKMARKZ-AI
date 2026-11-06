'use client';
/**
 * Dark-glass review deck.   npm i framer-motion
 * Keys: Space / Enter flip · 1 Again · 2 Hard · 3 Good · 4 Easy · Z undo is intentionally absent (reviews are final, server-side).
 */
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RATINGS, previewLabels, type Rating, type Sched } from '@/lib/flashcards/sm2';

interface Card extends Sched { id: string; question: string; answer: string; evidence: string | null; item: { id: string; title: string; url: string } }
interface Stats { due: number; newAvailable: number; total: number; streak: number; reviewedToday: boolean }
type Load = { s: 'loading' } | { s: 'error' } | { s: 'ready'; cards: Card[]; stats: Stats };

const RATE_STYLE: Record<Rating, string> = {
  0: 'from-rose-500/25 to-rose-500/5 border-rose-400/30 hover:border-rose-300/60 text-rose-100',
  1: 'from-amber-500/25 to-amber-500/5 border-amber-400/30 hover:border-amber-300/60 text-amber-100',
  2: 'from-emerald-500/30 to-emerald-500/5 border-emerald-400/40 hover:border-emerald-300/70 text-emerald-50',
  3: 'from-sky-500/25 to-sky-500/5 border-sky-400/30 hover:border-sky-300/60 text-sky-100',
};
const glass = 'border border-white/10 bg-white/[0.06] backdrop-blur-xl shadow-[0_8px_40px_rgba(0,0,0,.35),inset_0_1px_0_rgba(255,255,255,.08)]';
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

export default function ReviewDeck() {
  const reduce = useReducedMotion();
  const [load, setLoad] = useState<Load>({ s: 'loading' });
  const [queue, setQueue] = useState<Card[]>([]);
  const [flipped, setFlipped] = useState(false);
  const [tally, setTally] = useState({ 0: 0, 1: 0, 2: 0, 3: 0 } as Record<Rating, number>);
  const [unsaved, setUnsaved] = useState<{ cardId: string; rating: Rating; ms: number }[]>([]);
  const shownAt = useRef(0);
  const total = useRef(0);

  const fetchDeck = useCallback(async () => {
    setLoad({ s: 'loading' });
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const r = await fetch(`/api/flashcards/due?limit=20&tz=${encodeURIComponent(tz)}`, { cache: 'no-store' });
      if (r.status === 401) { window.location.href = '/login?next=/dashboard/review'; return; }
      if (!r.ok) throw new Error('load');
      const j = await r.json();
      setQueue(j.cards); total.current = j.cards.length; setFlipped(false); setTally({ 0: 0, 1: 0, 2: 0, 3: 0 });
      setLoad({ s: 'ready', cards: j.cards, stats: j.stats });
    } catch { setLoad({ s: 'error' }); }
  }, []);
  useEffect(() => { void fetchDeck(); }, [fetchDeck]);
  useEffect(() => { shownAt.current = Date.now(); }, [queue[0]?.id, tally[0]]);          // time-to-answer starts when a card appears

  const send = useCallback(async (p: { cardId: string; rating: Rating; ms: number }) => {
    try {
      const r = await fetch('/api/flashcards/review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) });
      if (!r.ok && r.status !== 404 && r.status !== 409) throw new Error('save');            // 404/409: card deleted or suspended elsewhere, nothing to retry
      setUnsaved((u) => u.filter((x) => x.cardId !== p.cardId));
    } catch { setUnsaved((u) => (u.some((x) => x.cardId === p.cardId) ? u : [...u, p])); }
  }, []);

  const rate = useCallback((rating: Rating) => {
    const card = queue[0]; if (!card) return;
    // Side effects live here, never inside a state updater: React StrictMode runs updaters twice and would double-submit the review.
    void send({ cardId: card.id, rating, ms: Math.min(Date.now() - shownAt.current, 600_000) });          // optimistic: the next card shows immediately
    setTally((t) => ({ ...t, [rating]: t[rating] + 1 }));
    setQueue((q) => { const rest = q.slice(1); if (rating === 0) rest.splice(Math.min(3, rest.length), 0, q[0]); return rest; });   // 'Again' returns later in this session
    setFlipped(false);
  }, [queue, send]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ' || e.key === 'Enter') { if (t?.tagName === 'BUTTON' || t?.tagName === 'A') return; e.preventDefault(); setFlipped((f) => !f); }
      else if (flipped && '1234'.includes(e.key) && e.key.length === 1) rate((Number(e.key) - 1) as Rating);
    };
    window.addEventListener('keydown', on); return () => window.removeEventListener('keydown', on);
  }, [flipped, rate]);

  const card = queue[0];
  const labels = useMemo(() => (card ? previewLabels(card) : []), [card]);
  const done = load.s === 'ready' && total.current > 0 && queue.length === 0;
  const reviewed = tally[0] + tally[1] + tally[2] + tally[3];
  const progress = total.current ? Math.min(1, Math.max(0, 1 - queue.length / (total.current + tally[0]))) : 0;
  const spring = reduce ? { duration: 0 } : { type: 'spring' as const, stiffness: 260, damping: 26 };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#06100b] text-emerald-50">
      {/* ambient light */}
      <motion.div aria-hidden className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-emerald-500/20 blur-3xl" animate={reduce ? undefined : { x: [0, 40, 0], y: [0, 30, 0] }} transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }} />
      <motion.div aria-hidden className="pointer-events-none absolute -bottom-40 -right-24 h-[26rem] w-[26rem] rounded-full bg-teal-400/10 blur-3xl" animate={reduce ? undefined : { x: [0, -30, 0], y: [0, -40, 0] }} transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }} />

      <div className="relative mx-auto flex min-h-screen max-w-2xl flex-col px-4 pb-8 pt-5 sm:pt-8">
        <header className="mb-5 flex items-center justify-between gap-3">
          <Link href="/dashboard" className="rounded-lg px-2 py-1 text-sm text-emerald-200/80 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300">← Dashboard</Link>
          {load.s === 'ready' && (
            <div className="flex items-center gap-2 text-xs">
              <span className={`${glass} rounded-full px-3 py-1`} title="Cards due now">{load.stats.due} due</span>
              <span className={`${glass} rounded-full px-3 py-1`} title="Days in a row with a review">🔥 {load.stats.streak + (load.stats.reviewedToday || reviewed === 0 ? 0 : 1)} day{load.stats.streak === 1 ? '' : 's'}</span>
            </div>
          )}
        </header>

        {load.s === 'ready' && total.current > 0 && !done && (
          <div className="mb-5" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="Session progress">
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10"><motion.div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-300" initial={false} animate={{ width: `${progress * 100}%` }} transition={spring} /></div>
            <p className="mt-1.5 text-right text-xs text-emerald-200/60">{queue.length} left</p>
          </div>
        )}

        {unsaved.length > 0 && (
          <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-100">
            <span>{unsaved.length} answer{unsaved.length === 1 ? '' : 's'} couldn’t be saved.</span>
            <button onClick={() => unsaved.forEach((u) => void send(u))} className="rounded-lg bg-amber-400/20 px-3 py-1 font-semibold hover:bg-amber-400/30">Retry</button>
          </div>
        )}

        <main className="flex flex-1 flex-col justify-center" aria-live="polite">
          {load.s === 'loading' && <div className={`${glass} h-72 animate-pulse rounded-3xl`} aria-label="Loading cards" />}
          {load.s === 'error' && <Notice title="Couldn’t load your cards" body="Check your connection and try again."><button onClick={fetchDeck} className="mt-4 rounded-xl bg-emerald-400/90 px-5 py-2.5 font-semibold text-emerald-950 hover:bg-emerald-300">Retry</button></Notice>}
          {load.s === 'ready' && total.current === 0 && (
            <Notice title={load.stats.total === 0 ? 'No flashcards yet' : 'All caught up'} body={load.stats.total === 0 ? 'Turn a bookmark into cards below, then come back to review.' : 'Nothing is due right now. Come back later, or make cards from more bookmarks.'} />
          )}

          {card && (
            <div className="[perspective:1400px]">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={card.id + tally[0]} initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduce ? { opacity: 0 } : { opacity: 0, x: -60, rotate: -3 }} transition={spring}>
                  <button type="button" onClick={() => setFlipped((f) => !f)} aria-pressed={flipped} aria-label={flipped ? 'Showing the answer. Press to show the question.' : 'Press to show the answer'}
                    className="relative block h-[22rem] w-full rounded-3xl text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-300 sm:h-[24rem]">
                    <motion.div className="absolute inset-0 [transform-style:preserve-3d]" animate={reduce ? undefined : { rotateY: flipped ? 180 : 0 }} transition={spring}>
                      {/* front */}
                      <div className={`${glass} absolute inset-0 flex flex-col justify-between rounded-3xl p-6 sm:p-8 [backface-visibility:hidden]`} style={reduce ? { opacity: flipped ? 0 : 1, pointerEvents: 'none' } : undefined} aria-hidden={flipped}>
                        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300/80">{card.state === 'new' ? 'New card' : card.state === 'learning' ? 'Relearning' : 'Question'}</span>
                        <p className="text-balance text-xl font-semibold leading-snug sm:text-2xl">{card.question}</p>
                        <span className="text-xs text-emerald-200/50">Tap or press Space to reveal</span>
                      </div>
                      {/* back */}
                      <div className={`${glass} absolute inset-0 flex flex-col justify-between overflow-y-auto rounded-3xl bg-emerald-400/[0.07] p-6 sm:p-8 ${reduce ? '' : '[transform:rotateY(180deg)] [backface-visibility:hidden]'}`} style={reduce ? { opacity: flipped ? 1 : 0, pointerEvents: 'none' } : undefined} aria-hidden={!flipped}>
                        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300/80">Answer</span>
                        <div>
                          <p className="text-balance text-lg font-medium leading-snug sm:text-xl">{card.answer}</p>
                          {card.evidence && <blockquote className="mt-4 border-l-2 border-emerald-400/40 pl-3 text-sm italic leading-relaxed text-emerald-100/70">“{card.evidence}”</blockquote>}
                        </div>
                        <span className="truncate text-xs text-emerald-200/50">From {card.item.title || host(card.item.url) || 'your bookmark'}</span>
                      </div>
                    </motion.div>
                  </button>
                </motion.div>
              </AnimatePresence>

              <AnimatePresence initial={false}>
                {flipped && (
                  <motion.div key="rate" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={spring} className="mt-5 grid grid-cols-4 gap-2 sm:gap-3">
                    {RATINGS.map((r, i) => (
                      <motion.button key={r.value} whileTap={reduce ? undefined : { scale: 0.95 }} whileHover={reduce ? undefined : { y: -2 }} onClick={() => rate(r.value)} aria-label={`${r.label}, next review in ${labels[i]} (key ${r.key})`}
                        className={`rounded-2xl border bg-gradient-to-b px-1 py-3 text-center backdrop-blur-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${RATE_STYLE[r.value]}`}>
                        <span className="block text-sm font-semibold">{r.label}</span>
                        <span className="mt-0.5 block text-[11px] opacity-70">{labels[i]}</span>
                      </motion.button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
              {!flipped && <p className="mt-5 text-center text-xs text-emerald-200/40">Space to flip · 1 Again · 2 Hard · 3 Good · 4 Easy</p>}
            </div>
          )}

          {done && (
            <motion.section initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={spring} className={`${glass} rounded-3xl p-8 text-center`}>
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...spring, delay: 0.1 }} className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-400/20 text-2xl">✓</motion.div>
              <h1 className="mt-4 text-2xl font-bold">Session complete</h1>
              <p className="mt-1 text-emerald-100/70">{reviewed} review{reviewed === 1 ? '' : 's'} · {Math.round(((tally[2] + tally[3]) / Math.max(reviewed, 1)) * 100)}% recalled</p>
              <div className="mt-5 grid grid-cols-4 gap-2 text-sm">
                {RATINGS.map((r, i) => (
                  <motion.div key={r.value} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.06 }} className="rounded-xl bg-white/5 py-2">
                    <div className="text-lg font-semibold">{tally[r.value]}</div><div className="text-xs text-emerald-200/60">{r.label}</div>
                  </motion.div>
                ))}
              </div>
              <button onClick={fetchDeck} className="mt-6 rounded-xl bg-emerald-400/90 px-6 py-2.5 font-semibold text-emerald-950 hover:bg-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-200">Check for more</button>
            </motion.section>
          )}
        </main>
      </div>
    </div>
  );
}

function Notice({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return <div className={`${glass} rounded-3xl p-8 text-center`}><h1 className="text-xl font-semibold">{title}</h1><p className="mx-auto mt-2 max-w-sm text-emerald-100/70">{body}</p>{children}</div>;
}
