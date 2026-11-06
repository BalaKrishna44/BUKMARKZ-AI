'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/m', label: 'Library', d: 'M5 4h14v16l-7-4-7 4z' },
  { href: '/m/stacks', label: 'Stacks', d: 'm12 3 9 5-9 5-9-5zM3 13l9 5 9-5' },
  { href: '/m/you', label: 'You', d: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21a8 8 0 0 1 16 0' },
] as const;

export default function MobileNav() {
  const path = usePathname();
  const on = (h: string) => (h === '/m' ? path === '/m' : path.startsWith(h));
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 flex border-t border-[#d6e8dc] bg-white/95 px-1.5 pt-2 backdrop-blur" style={{ paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))' }}>
      {TABS.map(t => (
        <Link key={t.href} href={t.href} aria-current={on(t.href) ? 'page' : undefined}
          className={`flex flex-1 flex-col items-center gap-0.5 py-1 text-[11.5px] ${on(t.href) ? 'font-bold text-[#1a7f4e]' : 'text-[#5b7266]'}`}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={t.d} /></svg>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
