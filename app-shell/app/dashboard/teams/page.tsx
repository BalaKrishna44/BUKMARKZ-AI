import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Page } from '@/components/shell/ui';
import TeamManager, { type OrgRow } from './TeamManager';

export const metadata: Metadata = { title: 'Team invites · Bukmarkz' };
export const dynamic = 'force-dynamic';

export default async function TeamsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/dashboard/teams');
  const { data } = await supabase.from('org_members').select('role, organizations(id,name,slug)').eq('user_id', user.id).limit(20);
  const orgs: OrgRow[] = ((data ?? []) as unknown as { role: string; organizations: { id: string; name: string; slug: string } | { id: string; name: string; slug: string }[] | null }[])
    .flatMap((m) => { const o = Array.isArray(m.organizations) ? m.organizations[0] : m.organizations; return o ? [{ id: o.id, name: o.name, slug: o.slug, role: m.role }] : []; });
  return (
    <Page title="Team invites" lead="Share a vault with your team. Create a workspace, then add teammates who already have a Bukmarkz account.">
      <TeamManager initial={orgs} defaultEmail={user.email ?? ''} />
    </Page>
  );
}
