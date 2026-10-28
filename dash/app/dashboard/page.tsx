import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ITEM_COLUMNS, toBookmark, type Bookmark, type Category, type ItemRow } from '@/lib/bookmarks';
import BookmarkFeedView from './BookmarkFeedView';

export const metadata: Metadata = { title: 'Dashboard · Bukmarkz' };
export const dynamic = 'force-dynamic';          // per-user data: never cache across users
const LIMIT = 1000;                              // newest 1000 are searched client-side; see README for server-side paging

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();      // getUser() verifies the JWT with Supabase (getSession() does not)
  if (!user) redirect('/login?next=/dashboard');

  const [items, cats] = await Promise.all([
    supabase.from('oneclist_items').select(ITEM_COLUMNS).eq('user_id', user.id)
      .order('created_at', { ascending: false }).limit(LIMIT).returns<ItemRow[]>(),
    supabase.from('categories').select('id,name,position').eq('user_id', user.id).order('position').returns<Category[]>(),
  ]);

  if (items.error || cats.error) {
    console.error('dashboard load failed', items.error?.message ?? cats.error?.message);   // never log row contents
    return (
      <main className="grid min-h-screen place-items-center bg-[#f1f9f4] p-6 text-[#33443b]">
        <div role="alert" className="max-w-md rounded-2xl border border-[#d8eedf] bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-[#10261c]">We couldn’t load your bookmarks</h1>
          <p className="mt-2 text-sm text-[#4b5c53]">Please refresh. If it keeps happening, check that the database migrations (002, 004, 005, 007) have been run.</p>
        </div>
      </main>
    );
  }

  const bookmarks = (items.data ?? []).map(toBookmark).filter((b): b is Bookmark => b !== null);
  return <BookmarkFeedView initialBookmarks={bookmarks} initialCategories={cats.data ?? []} userId={user.id} userEmail={user.email ?? ''} truncated={(items.data?.length ?? 0) >= LIMIT} />;
}
