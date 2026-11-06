import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import HighlightLibrary from '@/components/cite/HighlightLibrary';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Highlights · Bukmarkz', robots: { index: false, follow: false } };

export default async function HighlightsPage() {
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) redirect('/login?next=%2Fdashboard%2Fhighlights');
  return <main className="min-h-screen bg-[#08110e] bg-[radial-gradient(60rem_30rem_at_50%_-10%,rgba(16,185,129,.18),transparent)]"><HighlightLibrary /></main>;
}
