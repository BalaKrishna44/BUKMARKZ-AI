import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import AvatarUploader from '@/components/profile/AvatarUploader';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Profile | Bukmarkz' };

export default async function ProfileSettings() {
  const jar = await cookies();
  const sb = createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { cookies: { getAll: () => jar.getAll(), setAll: () => {} } });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');
  const { data } = await sb.from('user_profiles').select('avatar_url').eq('user_id', user.id).maybeSingle();   // RLS: own row only
  const name = (user.user_metadata?.name as string | undefined) ?? user.email ?? '?';
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-white">Profile</h1>
      <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl sm:p-8">
        <h2 className="mb-4 text-lg font-semibold text-white">Profile picture</h2>
        <AvatarUploader initialUrl={data?.avatar_url ?? null} name={name} />
      </section>
    </main>
  );
}
