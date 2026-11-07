'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { NAV, soonHref } from './nav';
import Wordmark from '@/components/brand/Wordmark';
import CommandPalette from './CommandPalette';

const PATHS: Record<string, string> = {
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z', globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  chat: 'M4 4h16v12H8l-4 4z', layers: 'm12 3 9 5-9 5-9-5zM3 13l9 5 9-5', download: 'M12 3v12m0 0-4-4m4 4 4-4M4 21h16',
  tabs: 'M3 6h18v14H3zM3 10h18', users: 'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM4 21c0-4 4-6 8-6s8 2 8 6', star: 'm12 3 3 6 6 1-4.5 4.5L17.5 21 12 18l-5.5 3 1-6.5L3 10l6-1z',
  monitor: 'M3 4h18v12H3zM8 20h8M12 16v4', link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z', puzzle: 'M9 3h4v3a2 2 0 1 1 0 4v3H9v-3a2 2 0 1 0 0-4zM13 13h4v4h-4z', plug: 'M9 3v5M15 3v5M6 8h12v4a6 6 0 0 1-12 0zM12 18v3',
  doc: 'M6 3h9l4 4v14H6zM9 12h7M9 16h7', mail: 'M3 6h18v12H3zm0 0 9 7 9-7', user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6', gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-2-4-2 1-2-1-1-2h-4l-1 2-2 1-2-1-2 4 2 1v2l-2 1 2 4 2-1 2 1 1 2h4l1-2 2-1 2 1 2-4-2-1z',
};
const Icon = ({ n }: { n: string }) => (
  <svg viewBox="0 0 24 24" className="size-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PATHS[n] ?? PATHS.doc} /></svg>
);

export default function AppShell({ email, children }: { email: string; children: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (h: string) => (h === '/dashboard' ? path === '/dashboard' : path === h || path.startsWith(h + '/'));
  return (
    <div className="min-h-screen bg-[#f1f9f4] text-[#33443b] lg:pl-64">
      <CommandPalette />
      <button onClick={() => window.dispatchEvent(new Event('bukmarkz:palette'))} className="fixed bottom-4 right-4 z-30 hidden rounded-full border border-[#d8eedf] bg-white px-3.5 py-2 text-xs font-semibold text-[#4b5c53] shadow-md hover:bg-[#e6f6ec] sm:block" aria-label="Open quick search">Quick search · Ctrl K</button>
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-[#d8eedf] bg-white/95 px-4 py-2.5 backdrop-blur lg:hidden">
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="grid size-9 place-items-center rounded-lg border border-[#d8eedf] text-[#10261c]">
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
        <span className="text-xl text-[#10261c]"><Wordmark /></span>
      </header>
      {open && <button aria-label="Close menu" onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-black/40 lg:hidden" />}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col overflow-y-auto bg-[#0d2418] px-3 py-5 text-[#cfe6d8] transition-transform lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <Link href="/dashboard/overview" className="mb-5 px-2 text-[28px] text-[#5be39c]"><Wordmark /></Link>
        <nav className="flex-1 space-y-5" aria-label="Main">
          {NAV.map((g) => (
            <div key={g.title}>
              <p className="px-2 pb-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#6f8f7c]">{g.title}</p>
              <ul className="space-y-0.5">
                {g.items.map((it) => {
                  const href = it.href ?? soonHref(it.label);
                  const on = it.href ? active(it.href) : false;
                  return (
                    <li key={it.label}>
                      <Link href={href} onClick={() => setOpen(false)} aria-current={on ? 'page' : undefined}
                        className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-[14px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-[#5be39c] ${on ? 'bg-[#164a31] text-white shadow-[inset_3px_0_0_#5be39c]' : 'hover:bg-[#133222] hover:text-white'}`}>
                        <Icon n={it.icon} /><span className="min-w-0 flex-1 truncate">{it.label}</span>
                        {!it.href && <span className="rounded-full bg-[#1b3d2b] px-1.5 py-0.5 text-[10px] font-semibold text-[#8fb7a0]">soon</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="mt-5 border-t border-[#1b3d2b] px-2 pt-4 text-xs text-[#8fb7a0]">
          <p className="truncate" title={email}>{email}</p>
          <form action="/auth/signout" method="post"><button className="mt-1.5 font-semibold text-[#5be39c] hover:underline">Sign out</button></form>
        </div>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
