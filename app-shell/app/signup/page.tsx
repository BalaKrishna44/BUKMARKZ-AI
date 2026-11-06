import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import SignupForm from './SignupForm';

export const metadata: Metadata = { title: 'Create account · Bukmarkz' };
export const dynamic = 'force-dynamic';

export default async function SignupPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect('/dashboard/overview');
  return <SignupForm />;
}
