'use client';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, Search, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { LINKS, SANDBOX_SUGGESTIONS } from '@/lib/demo/data';
import { answerFromVault } from '@/lib/demo/sandbox';
import { focusRing, panel } from '@/lib/ui';

const QUESTIONS = SANDBOX_SUGGESTIONS.slice(0, 3);

/** A looping "Ask Your Vault" demo. Answers come from the same tiny demo vault as the sandbox below, so what you see is what you can try. */
export default function HeroSearchMockup() {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0), [typed, setTyped] = useState(0), [paused, setPaused] = useState(false);
  const q = QUESTIONS[i];
  const a = useMemo(() => answerFromVault(q, LINKS), [q]);
  const done = typed >= q.length;

  useEffect(() => {
    if (reduce) { setTyped(q.length); return; }
    setTyped(0);
    let n = 0;
    const t = setInterval(() => { n += 1; setTyped(n); if (n >= q.length) clearInterval(t); }, 28);
    return () => clearInterval(t);
  }, [q, reduce]);

  useEffect(() => {                                                   // auto-advance, but never while the visitor is looking at it or has asked for less motion
    if (reduce || paused || !done) return;
    const t = setTimeout(() => setI((x) => (x + 1) % QUESTIONS.length), 5500);
    return () => clearTimeout(t);
  }, [done, paused, reduce]);

  return (
    <div className={`${panel} rounded-2xl p-4 shadow-2xl shadow-emerald-950/30 sm:p-5`} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={() => setPaused(false)}>
      <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5" role="img" aria-label={`Example question: ${q}`}>
        <Search className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
        <span className="min-w-0 truncate text-sm text-slate-200">{q.slice(0, typed)}{!done && <span className="ml-px inline-block h-4 w-px animate-pulse bg-emerald-400 align-middle" />}</span>
        <kbd className="ml-auto hidden shrink-0 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400 sm:block">Ask</kbd>
      </div>

      <div className="mt-4 min-h-44" aria-live="polite">
        <AnimatePresence mode="wait">
          {done && (
            <motion.div key={i} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0 }} transition={{ duration: 0.25 }}>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-400"><Sparkles className="h-3.5 w-3.5" aria-hidden />Buk found this in your vault</p>
              <p className="text-sm leading-relaxed text-slate-300">{a.answer}</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {a.sources.map((s) => (
                  <li key={s.id}><span className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-700 bg-slate-950/60 px-2.5 py-1 text-xs text-slate-300"><ArrowUpRight className="h-3 w-3 shrink-0 text-emerald-400" aria-hidden /><span className="truncate">{s.host}</span></span></li>
                ))}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div role="group" aria-label="Choose an example question" className="mt-2 flex gap-1.5">
        {QUESTIONS.map((_, k) => (
          <button key={k} type="button" onClick={() => setI(k)} aria-pressed={k === i} aria-label={`Example ${k + 1}`} className={`h-1.5 flex-1 rounded-full transition ${k === i ? 'bg-emerald-400' : 'bg-slate-700 hover:bg-slate-600'} ${focusRing}`} />
        ))}
      </div>
    </div>
  );
}
