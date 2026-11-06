import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Page, Panel } from '@/components/shell/ui';
import PrefToggle from '@/components/shell/PrefToggle';

export const metadata: Metadata = { title: 'Friday After-Hours' };
export const dynamic = 'force-dynamic';

export default async function FridayPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/dashboard/friday');
  const { data } = await supabase.from('friday_prefs').select('enabled,tz').eq('user_id', user.id).maybeSingle();
  return (
    <Page title="Friday After-Hours" lead="A short joke and your week in saves, emailed on Friday at 4 pm in your own time zone. Off until you turn it on, with a one-click unsubscribe in every email.">
      <PrefToggle label="Send me Friday After-Hours" rpc="set_friday_enabled" initial={!!data?.enabled} withTimezone
        detail={data?.enabled ? `Time zone on file: ${data.tz}.` : 'Your time zone is read from this browser when you turn it on.'} />
      <Panel title="What you get"><p className="text-sm text-[#4b5c53]">One joke a week, the links you saved since last Friday, and a share link. No tracking pixels you did not ask for.</p></Panel>
    </Page>
  );
}
