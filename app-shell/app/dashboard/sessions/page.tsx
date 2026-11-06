import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Page, Panel } from '@/components/shell/ui';
import SessionList, { type SessionRow } from './SessionList';

export const metadata: Metadata = { title: 'Flush session' };
export const dynamic = 'force-dynamic';

export default async function SessionsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/dashboard/sessions');
  const { data } = await supabase.from('sessions').select('id,title,summary,tab_count,shared,created_at').order('created_at', { ascending: false }).limit(100).returns<SessionRow[]>();
  return (
    <Page title="Flush session" lead="Save a whole window of tabs as one session, then close them. Sessions you flush from the browser extension appear here, and each one can be shared with a link.">
      {(data ?? []).length ? <SessionList initial={data ?? []} /> : (
        <Panel><p className="font-semibold text-[#10261c]">No sessions yet</p><p className="mt-1 text-sm text-[#4b5c53]">Install the browser extension, open the Bukmarkz popup and choose “Flush session”. Your saved tabs will show up here.</p></Panel>
      )}
    </Page>
  );
}
