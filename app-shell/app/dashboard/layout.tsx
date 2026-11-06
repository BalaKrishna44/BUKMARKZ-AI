import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Metadata } from 'next';
import AppShell from '@/components/shell/AppShell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };   // private pages stay out of search results

/** Every /dashboard/* page gets the sidebar. Auth is re-checked here (middleware already redirects, this is the second lock). */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/dashboard');
  return <AppShell email={user.email ?? ''}>{children}</AppShell>;
}
