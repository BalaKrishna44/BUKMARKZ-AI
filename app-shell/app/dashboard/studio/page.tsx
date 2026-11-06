import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ITEM_COLUMNS, toBookmark, type Bookmark, type ItemRow } from '@/lib/bookmarks';
import VaultStudioExporter, { type StudioSource } from '@/components/dashboard/VaultStudioExporter';

export const metadata: Metadata = { title: 'Vault Studio · Bukmarkz' };
export const dynamic = 'force-dynamic';

export default async function StudioPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/dashboard/studio');
  const { data } = await supabase.from('oneclist_items').select(ITEM_COLUMNS).eq('user_id', user.id).order('created_at', { ascending: false }).limit(50).returns<ItemRow[]>();
  const sources: StudioSource[] = (data ?? []).map(toBookmark).filter((b): b is Bookmark => b !== null && b.kind === 'link')
    .map((b) => ({ id: b.id, kind: 'bookmark' as const, title: b.title, url: b.url, summary: b.summary ?? b.note }));
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
      <h1 className="text-3xl font-extrabold tracking-tight text-[#10261c]">Vault Studio</h1>
      <p className="mt-1 text-[#4b5c53]">Turn any saved link into a 1200×630 share card, then download it as a PNG.</p>
      <div className="mt-6">{sources.length ? <VaultStudioExporter sources={sources} /> : <p className="rounded-2xl border border-[#d8eedf] bg-white p-6 text-[#4b5c53]">Save a few links first, then come back to make a card.</p>}</div>
    </main>
  );
}
