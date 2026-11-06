'use client';
import { Clapperboard, ExternalLink, FolderOpen, Layers, ShoppingBag, StickyNote } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Buk } from '@/components/brand/Mascots';
import HeaderSearch, { type AskResult, type SearchState } from '@/components/dashboard/HeaderSearch';
import MorningResurfaceWidget from '@/components/dashboard/MorningResurfaceWidget';
import { CATEGORIES, FILTERS, LINKS, hostOf } from '@/lib/demo/data';
import { answerFromVault, search } from '@/lib/demo/sandbox';
import { focusRing, panel, panelSoft } from '@/lib/ui';

const NAV = [['/dashboard/shorts', 'Shorts', Clapperboard], ['/dashboard/deals', 'Deals', ShoppingBag], ['/dashboard', 'Stacks', Layers]] as const;
/** Stand-in for POST /api/ask. A short delay so the loading state is visible. */
const demoAsk = (q: string): Promise<AskResult> => new Promise((res) => setTimeout(() => res(answerFromVault(q, LINKS)), 600));

export default function DashboardDemo() {
  const [cat, setCat] = useState<string | null>(null);
  const [s, setS] = useState<SearchState>({ query: '', mode: 'search', filters: [] });          // setState is a stable callback, as HeaderSearch requires

  const feed = useMemo(() => {
    let rows = s.query.trim() ? search(s.query, LINKS, 8).map((h) => h.link) : LINKS;
    if (cat) rows = rows.filter((l) => l.category === cat);
    if (s.filters.includes('Unread')) rows = rows.filter((l) => l.unread);
    if (s.filters.includes('This week')) rows = rows.filter((l) => l.thisWeek);
    if (s.filters.includes('Has note')) rows = rows.filter((l) => l.hasNote);
    return rows;
  }, [s, cat]);
  const counts = useMemo(() => Object.fromEntries(CATEGORIES.map((c) => [c, LINKS.filter((l) => l.category === c).length])), []);

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[14rem_minmax(0,1fr)_22rem]">
      <aside aria-label="Library" className="lg:sticky lg:top-6 lg:self-start">
        <Link href="/" className={`mb-4 hidden items-center gap-2 text-lg font-bold text-white lg:flex ${focusRing}`}><Buk className="h-8 w-8" />Bukmarkz</Link>
        <nav aria-label="Categories" className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1 lg:overflow-visible">
          <button type="button" aria-pressed={cat === null} onClick={() => setCat(null)} className={`flex shrink-0 items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ${cat === null ? 'bg-emerald-500/15 text-emerald-300' : 'text-slate-400 hover:bg-slate-900 hover:text-white'} ${focusRing}`}><span className="flex items-center gap-2"><FolderOpen className="h-4 w-4" aria-hidden />All</span><span className="text-xs text-slate-500">{LINKS.length}</span></button>
          {CATEGORIES.map((c) => <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(cat === c ? null : c)} className={`flex shrink-0 items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ${cat === c ? 'bg-emerald-500/15 text-emerald-300' : 'text-slate-400 hover:bg-slate-900 hover:text-white'} ${focusRing}`}>{c}<span className="text-xs text-slate-500">{counts[c]}</span></button>)}
        </nav>
        <nav aria-label="More" className="mt-4 hidden border-t border-slate-800 pt-4 lg:block">
          {NAV.map(([href, label, Icon]) => <Link key={label} href={href} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-900 hover:text-white ${focusRing}`}><Icon className="h-4 w-4" aria-hidden />{label}</Link>)}
        </nav>
      </aside>

      <main className="min-w-0">
        <HeaderSearch filterOptions={FILTERS} onChange={setS} ask={demoAsk} />
        <h1 className="mb-3 mt-6 text-sm font-semibold text-slate-300">{cat ?? 'All bookmarks'} <span className="font-normal text-slate-500">· {feed.length}</span></h1>
        {feed.length === 0 ? (
          <div className={`${panelSoft} rounded-2xl p-10 text-center`}><p className="font-medium text-white">Nothing matches</p><p className="mt-1 text-sm text-slate-400">Try a different word, or clear a filter.</p></div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {feed.map((l) => (
              <li key={l.id}>
                <article className={`${panel} group flex h-full flex-col rounded-2xl p-4 transition hover:border-emerald-500/40`}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs text-slate-500"><span className="truncate">{hostOf(l.url)}</span><span className="shrink-0">{l.saved}</span></div>
                  <h2 className="text-sm font-semibold leading-snug text-white"><a href={l.url} target="_blank" rel="noopener noreferrer" className={`hover:text-emerald-300 ${focusRing}`}>{l.title}<ExternalLink className="ml-1 inline h-3 w-3 opacity-60" aria-label="(opens in a new tab)" /></a></h2>
                  <p className="mt-1.5 line-clamp-3 flex-1 text-xs leading-relaxed text-slate-400">{l.summary}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">{l.category}</span>
                    {l.tags.slice(0, 2).map((t) => <span key={t} className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">#{t}</span>)}
                    {l.unread && <span className="ml-auto text-[11px] font-medium text-amber-300">Unread</span>}
                    {l.hasNote && <StickyNote className="ml-auto h-3.5 w-3.5 text-slate-500" aria-label="Has a note" />}
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}
      </main>

      <div className="min-w-0 lg:sticky lg:top-6 lg:self-start"><MorningResurfaceWidget /></div>
    </div>
  );
}
