import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
type Row = { id: string; slug: string; title: string; is_public: boolean; created_at: string; stack_items: { count: number }[] | null };

export default async function StacksPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from('stacks').select('id,slug,title,is_public,created_at,stack_items(count)').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100).returns<Row[]>();
  if (error) { console.error('mobile stacks failed', error.code); return <p role="alert" className="text-sm">We couldn’t load your stacks.</p>; }
  return (
    <div className="pt-2">
      <h1 className="mb-3 text-[22px] font-bold tracking-tight">Stacks</h1>
      {!data?.length && <p className="rounded-2xl border border-[#d6e8dc] bg-white p-5 text-sm text-[#5b7266]">No stacks yet. Create one on the web app and it will show up here.</p>}
      <ul className="space-y-3">
        {(data ?? []).map(s => (
          <li key={s.id} className="rounded-[18px] bg-[#0e2a1c] p-4 text-[#ecfdf5]">
            <p className="text-[17px] font-bold">{s.title}</p>
            <p className="text-[13px] text-[#a7f3d0]">{s.stack_items?.[0]?.count ?? 0} links · {s.is_public ? 'public' : 'private'}</p>
            {s.is_public && <a href={`/s/${encodeURIComponent(s.slug)}`} className="mt-3 inline-block rounded-[10px] border border-white/25 bg-white/10 px-3 py-1.5 text-[13px]">Open public page</a>}
          </li>))}
      </ul>
    </div>
  );
}
