import { createClient } from '@/lib/supabase/server';
import { ITEM_COLUMNS, toBookmark, type Bookmark, type ItemRow } from '@/lib/bookmarks';
import MobileLibrary from './MobileLibrary';

export const dynamic = 'force-dynamic';
const LIMIT = 500;                                  // newest 500, searched on the device; paging comes with the server-side search

export default async function LibraryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;                           // the layout already redirected
  const { data, error } = await supabase.from('oneclist_items').select(ITEM_COLUMNS).eq('user_id', user.id)
    .order('created_at', { ascending: false }).limit(LIMIT).returns<ItemRow[]>();
  if (error) { console.error('mobile library failed', error.code); return <p role="alert" className="rounded-2xl border border-[#d6e8dc] bg-white p-4 text-sm">We couldn’t load your library. Pull to refresh.</p>; }
  const items = (data ?? []).map(toBookmark).filter((b): b is Bookmark => b !== null);
  return <MobileLibrary items={items} />;
}
