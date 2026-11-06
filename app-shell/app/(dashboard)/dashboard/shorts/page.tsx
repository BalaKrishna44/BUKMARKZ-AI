import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ShortsFeed } from '@/components/dashboard/ShortsFeedCard';
import { SHORTS } from '@/lib/demo/data';
import { focusRing } from '@/lib/ui';

export const metadata: Metadata = { title: 'Shorts' };

export default function ShortsPage() {
  return (
    <>
      <header className="flex h-16 items-center gap-3 px-4"><Link href="/dashboard" className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-300 hover:text-white ${focusRing}`}><ArrowLeft className="h-4 w-4" aria-hidden />Dashboard</Link><h1 className="text-sm font-semibold text-white">Shorts</h1></header>
      <ShortsFeed items={SHORTS} />
    </>
  );
}
