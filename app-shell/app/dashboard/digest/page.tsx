import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Page } from '@/components/shell/ui';
import PrefToggle from '@/components/shell/PrefToggle';

export const metadata: Metadata = { title: 'Weekly digest' };
export const dynamic = 'force-dynamic';

export default async function DigestPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/dashboard/digest');
  const { data } = await supabase.from('digest_prefs').select('enabled,last_sent_at').eq('user_id', user.id).maybeSingle();
  return (
    <Page title="Weekly digest" lead="Once a week we email you a few links you saved and forgot about. It is off until you turn it on, and every email has a one-click unsubscribe.">
      <PrefToggle label="Email me the weekly digest" rpc="set_digest_enabled" initial={!!data?.enabled}
        detail={data?.last_sent_at ? `Last sent ${new Date(data.last_sent_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}.` : 'Sent to ' + (user.email ?? 'your address') + '.'} />
    </Page>
  );
}
