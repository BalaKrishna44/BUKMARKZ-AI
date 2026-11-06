/** Shared class strings (Tailwind v4 picks classes up from .ts files too). */
export const panel = 'bg-slate-900/80 border border-slate-800 backdrop-blur-md';
export const panelSoft = 'bg-slate-900/60 border border-slate-800/80 backdrop-blur-md';
export const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400';
export const btnPrimary = `inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-950/40 transition hover:bg-emerald-400 ${focusRing}`;
export const btnGhost = `inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900/60 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:border-emerald-500/50 hover:text-white ${focusRing}`;
