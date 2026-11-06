import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Overview · Bukmarkz' };
export const dynamic = 'force-dynamic';

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-2xl border border-[#d8eedf] bg-white p-5 shadow-sm"><h2 className="text-sm font-semibold text-[#4b5c53]">{title}</h2><div className="mt-2">{children}</div></section>
);

export default async function Overview() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/dashboard/overview');
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const [all, week, tasks, cats, recent] = await Promise.all([
    supabase.from('oneclist_items').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    supabase.from('oneclist_items').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', weekAgo),
    supabase.from('oneclist_items').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('item_type', 'oneclist_task').is('completed_at', null),
    supabase.from('categories').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    supabase.from('oneclist_items').select('id,title,url,created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(5),
  ]);
  const n = (r: { count: number | null }) => (r.count ?? 0).toLocaleString('en-US');
  const total = all.count ?? 0;
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
      <h1 className="text-3xl font-extrabold tracking-tight text-[#10261c]">Overview</h1>
      <p className="mt-1 text-[#4b5c53]">Your vault at a glance.</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card title="Saved links"><p className="text-4xl font-extrabold text-[#10261c]">{n(all)}</p><p className="text-sm font-medium text-[#1a7f4e]">+{n(week)} this week</p></Card>
        <Card title="Open tasks"><p className="text-4xl font-extrabold text-[#10261c]">{n(tasks)}</p></Card>
        <Card title="Categories"><p className="text-4xl font-extrabold text-[#10261c]">{n(cats)}</p></Card>
        <Card title="Plan"><p className="text-xl font-bold text-[#10261c]">Pro trial</p><p className="text-sm text-[#4b5c53]">Usage meters arrive with billing.</p></Card>
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2"><Card title="Recently saved">
          {total === 0 ? (
            <div className="py-6 text-center"><p className="font-semibold text-[#10261c]">Your vault is empty</p><p className="mt-1 text-sm text-[#4b5c53]">Import your bookmarks to get started.</p>
              <Link href="/dashboard/import/resume" className="mt-4 inline-block rounded-xl bg-[#2fa66a] px-4 py-2 text-sm font-semibold text-[#04230f] hover:bg-[#4fbf85]">Import bookmarks</Link></div>
          ) : (
            <ul className="divide-y divide-[#e6f3ea]">{(recent.data ?? []).map((r) => (
              <li key={r.id} className="py-2.5"><a href={r.url} target="_blank" rel="noopener noreferrer" className="block truncate font-medium text-[#10261c] hover:underline">{r.title || r.url}</a>
                <span className="text-xs text-[#66766d]">{new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span></li>
            ))}</ul>
          )}
        </Card></div>
        <Card title="Quick links"><ul className="space-y-2 text-sm font-medium text-[#1a7f4e]">
          <li><Link className="hover:underline" href="/dashboard">Open my vault & Ask</Link></li>
          <li><Link className="hover:underline" href="/dashboard/studio">Make a share card (Vault Studio)</Link></li>
          <li><Link className="hover:underline" href="/dashboard/import/resume">Import bookmarks</Link></li>
          <li><Link className="hover:underline" href="/settings/profile">Edit profile</Link></li>
        </ul></Card>
      </div>
    </main>
  );
}
