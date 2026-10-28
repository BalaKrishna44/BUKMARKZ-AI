import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { safeNext } from '@/lib/safeNext';
import LoginForm from './LoginForm';

export const metadata: Metadata = { title: 'Sign in · Bukmarkz' };
export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect(next);                                   // already signed in
  return <LoginForm next={next} linkFailed={sp.error === 'link'} />;
}
