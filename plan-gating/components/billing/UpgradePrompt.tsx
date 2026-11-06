'use client';
import { FEATURE_LABEL, PITCH, isBudgetInfo, safeUpgradeHref, type BudgetInfo, type LimitInfo } from '@/lib/upgrade';

/**
 * Inline upgrade card. Render it where the blocked action's result would have appeared:
 *   const res = await fetch('/api/ask', ...); const limit = await readLimit(res);
 *   return limit ? <UpgradePrompt info={limit} onDismiss={() => setLimit(null)} /> : ...
 */
export function UpgradePrompt({ info, onDismiss }: { info: LimitInfo | BudgetInfo; onDismiss?: () => void }) {
  const budget = isBudgetInfo(info);
  const title = budget ? 'AI allowance used up' : info.reason === 'plan' ? `${FEATURE_LABEL[info.feature]} is a Pro feature` : `${FEATURE_LABEL[info.feature]} limit reached`;
  const pitch = budget ? 'Pro gives you a much larger monthly AI allowance.' : PITCH[info.feature];
  const resets = info.resetsAt ? new Date(info.resetsAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', timeZone: 'UTC' }) : null;
  const pct = !budget && info.limit > 0 ? Math.min(100, Math.round((info.used / info.limit) * 100)) : 100;
  return (
    <div role="alert" className="rounded-xl border border-emerald-500/30 bg-slate-900/80 p-4 text-slate-200 backdrop-blur-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-50">{title}</p>
          <p className="mt-1 text-sm text-slate-400">{info.message}</p>
        </div>
        {onDismiss && <button type="button" onClick={onDismiss} aria-label="Dismiss" className="rounded-md px-2 text-slate-500 hover:text-slate-300">×</button>}
      </div>
      {!budget && info.reason !== 'plan' && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800" aria-hidden="true"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
      )}
      <p className="mt-3 text-sm text-slate-300">{pitch}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <a href={safeUpgradeHref(info.upgradeUrl)} className="rounded-lg bg-emerald-500 px-3.5 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400">
          {info.plan === 'pro' ? 'See Team plan' : 'Upgrade to Pro'}
        </a>
        {resets && <span className="text-xs text-slate-500">Resets {resets}</span>}
      </div>
    </div>
  );
}
