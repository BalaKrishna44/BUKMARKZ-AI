import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import ReviewDeck from '@/components/flashcards/ReviewDeck';
import MakeCards, { type Candidate } from '@/components/flashcards/MakeCards';

export const metadata: Metadata = { title: 'Review', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function ReviewPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/dashboard/review');

  // Archived bookmarks with no cards yet, newest first. RLS + the explicit filter keep this to the owner's rows.
  const { data } = await supabase.from('oneclist_items').select('id,title,url').eq('user_id', user.id)
    .eq('archive_status', 'done').in('cards_status', ['none', 'failed']).neq('ai_status', 'skipped_private')
    .order('archived_at', { ascending: false }).limit(6).returns<Candidate[]>();

  return (
    <div className="bg-[#06100b]">
      <ReviewDeck />
      <div className="mx-auto max-w-2xl px-4 pb-12"><MakeCards items={data ?? []} /></div>
    </div>
  );
}
