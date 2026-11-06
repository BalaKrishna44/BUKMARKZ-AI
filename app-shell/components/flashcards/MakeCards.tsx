'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface Candidate { id: string; title: string; url: string }
type S = { s: 'idle' } | { s: 'busy' } | { s: 'done'; created: number } | { s: 'err'; msg: string };
const MSG: Record<string, string> = { private_item: 'Marked private: never sent to AI.', not_enough_text: 'Not enough text yet. Archive the page first.', daily_limit: 'Daily limit reached. Try tomorrow.', in_progress: 'Already working on it…', generation_failed: 'The AI step failed. Try again.' };

/** Bookmarks that have text but no cards yet, each with a one-tap "Make cards". */
export default function MakeCards({ items }: { items: Candidate[] }) {
  const router = useRouter();
  const [st, setSt] = useState<Record<string, S>>({});
  if (!items.length) return null;

  const run = async (id: string) => {
    setSt((s) => ({ ...s, [id]: { s: 'busy' } }));
    try {
      const r = await fetch('/api/flashcards/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itemId: id }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return setSt((s) => ({ ...s, [id]: { s: 'err', msg: MSG[j.error] ?? 'Something went wrong.' } }));
      setSt((s) => ({ ...s, [id]: { s: 'done', created: j.created ?? 0 } })); router.refresh();
    } catch { setSt((s) => ({ ...s, [id]: { s: 'err', msg: 'Network error.' } })); }
  };

  return (
    <section aria-labelledby="mk-h" className="mt-8 rounded-3xl border border-white/10 bg-white/[0.05] p-5 backdrop-blur-xl">
      <h2 id="mk-h" className="text-sm font-semibold uppercase tracking-[0.14em] text-emerald-300/80">Turn bookmarks into cards</h2>
      <ul className="mt-3 divide-y divide-white/10">
        <AnimatePresence initial={false}>
          {items.map((it) => {
            const s = st[it.id] ?? { s: 'idle' };
            return (
              <motion.li key={it.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0"><p className="truncate font-medium text-emerald-50">{it.title || it.url}</p>{s.s === 'err' && <p role="alert" className="text-xs text-rose-300">{s.msg}</p>}</div>
                {s.s === 'done' ? <span className="shrink-0 text-sm text-emerald-300">{s.created ? `+${s.created} cards` : 'Done'}</span> : (
                  <button disabled={s.s === 'busy'} onClick={() => run(it.id)} className="shrink-0 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-sm font-semibold text-emerald-100 hover:bg-emerald-400/20 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300">
                    {s.s === 'busy' ? 'Writing cards…' : s.s === 'err' ? 'Retry' : 'Make cards'}
                  </button>)}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </section>
  );
}
