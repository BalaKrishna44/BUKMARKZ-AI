'use client';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, CheckCircle2, ExternalLink, Flame, Moon, RotateCcw, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Buk, Markz } from '@/components/brand/Mascots';
import { LINKS, QUIZ, RESURFACE, hostOf, type DemoLink, type QuizQ } from '@/lib/demo/data';
import { focusRing, panel } from '@/lib/ui';

type Status = 'new' | 'opened' | 'snoozed';
interface Props { items?: { link: DemoLink; why: string }[]; quiz?: QuizQ; initialStreak?: number; onItemAction?: (id: string, a: 'opened' | 'snoozed') => void; onQuizAnswer?: (id: string, correct: boolean) => void }

/** "Buk's Morning Resurface": five links worth a second look, plus a one-question recall challenge. Defaults to the demo data. */
export default function MorningResurfaceWidget({ items, quiz = QUIZ, initialStreak = 3, onItemAction, onQuizAnswer }: Props) {
  const reduce = useReducedMotion();
  const list = useMemo(() => items ?? RESURFACE.flatMap((r) => { const link = LINKS.find((l) => l.id === r.id); return link ? [{ link, why: r.why }] : []; }), [items]);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [picked, setPicked] = useState<number | null>(null), [streak, setStreak] = useState(initialStreak);
  const from = LINKS.find((l) => l.id === quiz.fromId);

  const touched = list.filter(({ link }) => status[link.id] && status[link.id] !== 'new').length;
  const mark = (id: string, s: 'opened' | 'snoozed') => { setStatus((p) => ({ ...p, [id]: s })); onItemAction?.(id, s); };
  const answer = (i: number) => {
    if (picked !== null) return;                                      // one try, like a real recall
    setPicked(i);
    const correct = i === quiz.answerIndex;
    setStreak((s) => (correct ? s + 1 : 0)); onQuizAnswer?.(quiz.id, correct);
  };
  const reset = () => { setStatus({}); setPicked(null); setStreak(initialStreak); };
  const spring = reduce ? { duration: 0 } : { duration: 0.2 };

  return (
    <section aria-labelledby="mr-h" className={`${panel} overflow-hidden rounded-2xl`}>
      <header className="flex items-center gap-3 border-b border-slate-800 bg-gradient-to-r from-emerald-950/60 to-transparent p-4">
        <div className="flex shrink-0 items-end"><Buk className="h-12 w-12" /><Markz className="-ml-2 h-8 w-8" /></div>
        <div className="min-w-0 flex-1"><h2 id="mr-h" className="text-sm font-bold text-white">Buk’s Morning Resurface</h2><p className="text-xs text-slate-400">{touched} of {list.length} revisited today</p></div>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-400/10 px-2.5 py-1 text-xs font-semibold text-amber-300" title="Correct recall answers in a row"><Flame className="h-3.5 w-3.5" aria-hidden />{streak}<span className="sr-only"> correct in a row</span></span>
      </header>

      <div className="h-1 bg-slate-800" role="progressbar" aria-label="Links revisited" aria-valuemin={0} aria-valuemax={list.length} aria-valuenow={touched}><div className="h-full bg-emerald-500 transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${(touched / Math.max(list.length, 1)) * 100}%` }} /></div>

      <ul className="divide-y divide-slate-800/80">
        {list.map(({ link, why }) => {
          const s = status[link.id] ?? 'new';
          return (
            <li key={link.id} className={`flex items-start gap-3 p-4 transition ${s === 'snoozed' ? 'opacity-45' : ''}`}>
              <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${s === 'opened' ? 'border-emerald-400 bg-emerald-500 text-slate-950' : 'border-slate-600 text-transparent'}`} aria-hidden><Check className="h-3 w-3" /></span>
              <div className="min-w-0 flex-1">
                <a href={link.url} target="_blank" rel="noopener noreferrer" onClick={() => mark(link.id, 'opened')} className={`group flex items-start gap-1 text-sm font-medium text-slate-100 hover:text-emerald-300 ${focusRing}`}><span className="line-clamp-2">{link.title}</span><ExternalLink className="mt-0.5 h-3 w-3 shrink-0 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden /></a>
                <p className="mt-0.5 text-xs text-slate-500">{hostOf(link.url)} · <span className="text-emerald-400/90">{why}</span></p>
              </div>
              {s === 'new' && <button type="button" onClick={() => mark(link.id, 'snoozed')} aria-label={`Snooze ${link.title}`} className={`shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200 ${focusRing}`}><Moon className="h-4 w-4" aria-hidden /></button>}
            </li>
          );
        })}
      </ul>

      <div className="border-t border-slate-800 bg-amber-400/[.04] p-4">
        <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-amber-200/90"><Markz className="h-6 w-6" />Markz’s recall challenge</p>
        <p className="text-sm font-medium leading-snug text-white">{quiz.question}</p>
        {from && <p className="mt-1 text-xs text-slate-500">From “{from.title}”</p>}
        <div className="mt-3 grid gap-2 sm:grid-cols-2" role="group" aria-label="Answer choices">
          {quiz.options.map((o, i) => {
            const right = picked !== null && i === quiz.answerIndex, wrong = picked === i && i !== quiz.answerIndex;
            return (
              <button key={o} type="button" disabled={picked !== null} aria-pressed={picked === i} onClick={() => answer(i)}
                className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm transition ${right ? 'border-emerald-400 bg-emerald-500/15 text-emerald-200' : wrong ? 'border-rose-400/70 bg-rose-500/10 text-rose-200' : 'border-slate-700 bg-slate-950/50 text-slate-200 hover:border-emerald-500/50'} disabled:cursor-default ${focusRing}`}>
                {o}{right && <CheckCircle2 className="h-4 w-4 shrink-0" aria-label="Correct answer" />}{wrong && <XCircle className="h-4 w-4 shrink-0" aria-label="Your answer, incorrect" />}
              </button>
            );
          })}
        </div>
        <div aria-live="polite">
          <AnimatePresence initial={false}>
            {picked !== null && (
              <motion.div key="exp" initial={reduce ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={spring} className="overflow-hidden">
                <p className="mt-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs leading-relaxed text-slate-300"><b className={picked === quiz.answerIndex ? 'text-emerald-300' : 'text-rose-300'}>{picked === quiz.answerIndex ? 'Nice recall. ' : 'Not quite. '}</b>{quiz.explanation}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {(picked !== null || touched > 0) && <button type="button" onClick={reset} className={`mt-3 inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 ${focusRing}`}><RotateCcw className="h-3 w-3" aria-hidden />Reset demo</button>}
      </div>
    </section>
  );
}
