'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { searchMatches, sourceLabel, type Bookmark } from '@/lib/bookmarks';

const COLORS = ['#1a7f4e', '#7c3aed', '#0369a1', '#b45309', '#be123c', '#0f766e'];
const hue = (s: string) => COLORS[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];

/** Web pages open in a new tab; voice notes and scans have no web address, so they are plain cards. */
function Row({ b, children }: { b: Bookmark; children: React.ReactNode }) {
  const cls = 'flex gap-3 rounded-2xl border border-[#d6e8dc] bg-white p-3';
  return b.kind === 'link' ? <a href={b.url} target="_blank" rel="noopener noreferrer" className={cls}>{children}</a> : <div className={cls}>{children}</div>;
}

export default function MobileLibrary({ items }: { items: Bookmark[] }) {
  const [q, setQ] = useState(''); const [tag, setTag] = useState<string | null>(null);
  const tags = useMemo(() => { const n = new Map<string, number>(); items.forEach(b => b.tags.forEach(t => n.set(t, (n.get(t) ?? 0) + 1))); return [...n].sort((a, b) => b[1] - a[1]).slice(0, 12).map(x => x[0]); }, [items]);
  const shown = useMemo(() => items.filter(b => (!tag || b.tags.includes(tag)) && searchMatches(b, q, null)), [items, q, tag]);

  if (!items.length) return (
    <div className="mt-10 rounded-2xl border border-[#d6e8dc] bg-white p-6 text-center">
      <p className="font-semibold">Nothing saved yet</p>
      <p className="mt-1 text-sm text-[#5b7266]">Tap + to save a link, or share one from your browser to Bukmarkz.</p>
      <Link href="/m/save" className="mt-4 inline-block rounded-xl bg-[#1a7f4e] px-4 py-2.5 text-sm font-semibold text-white">Save your first link</Link>
    </div>);

  return (
    <>
      <label className="flex items-center gap-2 rounded-2xl border border-[#d6e8dc] bg-white px-3.5 py-3 text-[#5b7266]">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
        <input value={q} onChange={e => setQ(e.target.value)} type="search" enterKeyHint="search" placeholder="Search your saves" aria-label="Search your saves"
          className="min-w-0 flex-1 bg-transparent text-[15px] text-[#10261c] outline-none" />
      </label>
      {tags.length > 0 && (
        <div className="-mx-[18px] flex gap-2 overflow-x-auto px-[18px] py-2.5" role="group" aria-label="Filter by tag">
          {[null, ...tags].map(t => (
            <button key={t ?? 'all'} onClick={() => setTag(t)} aria-pressed={tag === t}
              className={`flex-none rounded-full border px-3 py-1.5 text-[13px] ${tag === t ? 'border-[#a9dcba] bg-[#d9f2e2] font-semibold text-[#0f5c36]' : 'border-[#d6e8dc] bg-white'}`}>{t ?? 'All'}</button>))}
        </div>)}
      <ul className="mt-1 space-y-2.5">
        {shown.map(b => (
          <li key={b.id}>
            <Row b={b}>
              <span aria-hidden="true" className="grid h-10 w-10 flex-none place-items-center rounded-xl text-base font-extrabold text-white" style={{ background: hue(sourceLabel(b)) }}>{b.title[0]?.toUpperCase()}</span>
              <span className="min-w-0">
                <span className="block break-words text-[15px] font-semibold leading-tight">{b.title}</span>
                <span className="mt-0.5 block text-[12.5px] text-[#5b7266]">{sourceLabel(b)}</span>
                {b.summary && <span className="mt-1.5 line-clamp-2 block text-[13px] text-[#26402f]">{b.summary}</span>}
                {b.tags.slice(0, 3).map(t => <span key={t} className="mr-1.5 mt-1.5 inline-block rounded-full bg-[#d9f2e2] px-2 py-0.5 text-[11.5px] text-[#0f5c36]">{t}</span>)}
              </span>
            </Row>
          </li>))}
      </ul>
      {!shown.length && <p className="mt-6 text-center text-sm text-[#5b7266]">No match. Try another word.</p>}
    </>
  );
}
