import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PWAProvider } from '@/components/PWAProvider';
import MobileNav from '@/components/mobile/MobileNav';

export const metadata: Metadata = { title: 'Bukmarkz', robots: { index: false }, icons: { apple: '/icons/apple-touch-icon.png' }, appleWebApp: { capable: true, title: 'Bukmarkz', statusBarStyle: 'black-translucent' } };
export const viewport: Viewport = { themeColor: '#0e2a1c', viewportFit: 'cover', width: 'device-width', initialScale: 1 };
export const dynamic = 'force-dynamic';

export default async function MobileLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();            // verified with Supabase, not just read from the cookie
  if (!user) redirect('/login?next=/m');
  return (
    <PWAProvider>
      <div className="min-h-dvh bg-[#f1f9f4] text-[#10261c]">
        <header className="flex items-center justify-between px-[18px] pb-2" style={{ paddingTop: 'calc(14px + env(safe-area-inset-top, 0px))' }}>
          <Link href="/m" aria-label="Bukmarkz home" className="text-2xl font-extrabold tracking-tight">Bukmarkz</Link>
          <span aria-hidden="true" className="grid h-[34px] w-[34px] place-items-center rounded-full bg-[#0e2a1c] text-sm font-bold text-[#86efac]">{(user.email ?? '?')[0].toUpperCase()}</span>
        </header>
        <main className="px-[18px] pb-28">{children}</main>
        <Link href="/m/save" aria-label="Save a link" className="fixed right-[18px] z-20 grid h-14 w-14 place-items-center rounded-2xl bg-[#1a7f4e] text-3xl text-white shadow-lg" style={{ bottom: 'calc(84px + env(safe-area-inset-bottom, 0px))' }}>+</Link>
        <Link href="/m/voice" aria-label="Record a voice note" className="fixed right-[86px] z-20 grid h-14 w-14 place-items-center rounded-2xl border border-[#d6e8dc] bg-white text-[#1a7f4e] shadow-lg" style={{ bottom: 'calc(84px + env(safe-area-inset-bottom, 0px))' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
        </Link>
        <MobileNav />
      </div>
    </PWAProvider>
  );
}
