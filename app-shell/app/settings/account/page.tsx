import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import DeleteAccount from '@/components/account/DeleteAccount';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Account | Bukmarkz' };

export default async function AccountSettings() {
  const jar = await cookies();
  const sb = createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { cookies: { getAll: () => jar.getAll(), setAll: () => {} } });
  const { data: { user } } = await sb.auth.getUser();
  if (!user || !user.email) redirect('/login');
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-white">Account</h1>
      <div className="mt-8"><DeleteAccount email={user.email} /></div>
    </main>
  );
}
