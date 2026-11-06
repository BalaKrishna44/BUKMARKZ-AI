'use client';
import { useEffect, useState } from 'react';
import { computeChecklist, type OnboardingState } from '@/lib/onboarding/checklist';
import { createClient } from '@/lib/supabase/client'; // your existing browser helper

export function FirstRunChecklist() {
  const [state, setState] = useState<OnboardingState | null>(null);
  useEffect(() => {
    const sb = createClient();
    sb.rpc('onboarding_state').then(({ data }) => { if (data) setState(data as OnboardingState); });
  }, []);
  if (!state) return null;
  const c = computeChecklist(state);
  if (!c.visible) return null;
  const dismiss = async () => { setState({ ...state, dismissed: true }); await createClient().rpc('onboarding_mark', { p_step: 'dismiss' }); };
  return (
    <section aria-label="Getting started" className="rounded-2xl border border-emerald-500/30 bg-slate-900/60 p-4 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Get started <span className="opacity-60">({c.doneCount}/{c.total})</span></h2>
        <button type="button" onClick={dismiss} className="text-sm opacity-70 hover:opacity-100">Hide</button>
      </div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={c.total} aria-valuenow={c.doneCount} className="mt-2 h-1.5 overflow-hidden rounded bg-slate-800">
        <div className="h-full bg-emerald-400 transition-all" style={{ width: `${(c.doneCount / c.total) * 100}%` }} />
      </div>
      <ul className="mt-3 space-y-2">
        {c.steps.map((s) => (
          <li key={s.id} className="flex items-start gap-3">
            <span aria-hidden className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs ${s.done ? 'bg-emerald-400 text-slate-950' : 'border border-slate-600'}`}>{s.done ? '✓' : ''}</span>
            <div className="min-w-0">
              <a href={s.href} className={`font-medium ${s.done ? 'line-through opacity-60' : ''}`}>{s.title}</a>
              {!s.done && <p className="text-sm opacity-70">{s.hint}</p>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
