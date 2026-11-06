import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Page, Panel } from '@/components/shell/ui';

export const metadata: Metadata = { title: 'Link health · Bukmarkz' };
export const dynamic = 'force-dynamic';

interface Dead { id: string; title: string | null; url: string; dead_since: string | null; link_error: string | null; link_http_status: number | null; archive_url: string | null }
const WHY: Record<string, string> = { http_404: 'Page not found (404)', http_410: 'Page removed (410)', timeout: 'Timed out', dns_nxdomain: 'Site no longer exists' };

export default async function LinkHealth() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/dashboard/link-health');
  const [dead, checked, total] = await Promise.all([
    supabase.from('oneclist_items').select('id,title,url,dead_since,link_error,link_http_status,archive_url').eq('user_id', user.id).eq('is_dead', true).order('dead_since', { ascending: false }).limit(200).returns<Dead[]>(),
    supabase.from('oneclist_items').select('id', { count: 'exact', head: true }).eq('user_id', user.id).not('link_checked_at', 'is', null),
    supabase.from('oneclist_items').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
  ]);
  if (dead.error) return <Page title="Link health" lead="Dead-link checker"><Panel><p className="text-sm text-[#4b5c53]">Link health is not set up on this database yet.</p></Panel></Page>;
  const rows = dead.data ?? [];
  return (
    <Page title="Link health" lead="Bukmarkz re-checks your saved links in the background and flags the ones that have died. When the Internet Archive has a copy, you get a link to it.">
      <div className="grid gap-4 sm:grid-cols-3">
        <Panel title="Checked so far"><p className="text-3xl font-extrabold text-[#10261c]">{(checked.count ?? 0).toLocaleString('en-US')}<span className="text-base font-medium text-[#66766d]"> of {(total.count ?? 0).toLocaleString('en-US')}</span></p></Panel>
        <Panel title="Dead links"><p className="text-3xl font-extrabold text-[#10261c]">{rows.length}</p></Panel>
        <Panel title="Rule"><p className="text-sm text-[#4b5c53]">A link is marked dead after repeated failures, never after one blip.</p></Panel>
      </div>
      <Panel title="Dead links">
        {rows.length === 0 ? <p className="text-sm text-[#4b5c53]">No dead links found. Nice and tidy.</p> : (
          <ul className="divide-y divide-[#e6f3ea]">{rows.map((r) => (
            <li key={r.id} className="py-3">
              <p className="truncate font-medium text-[#10261c]">{r.title || r.url}</p>
              <p className="truncate text-xs text-[#66766d]">{r.url}</p>
              <p className="mt-1 text-xs text-[#4b5c53]">{WHY[r.link_error ?? ''] ?? (r.link_http_status ? `HTTP ${r.link_http_status}` : 'Unreachable')}{r.dead_since ? ` · since ${new Date(r.dead_since).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}
                {r.archive_url && <> · <a className="font-semibold text-[#1a7f4e] hover:underline" href={r.archive_url} target="_blank" rel="noopener noreferrer">View archived copy</a></>}</p>
            </li>
          ))}</ul>
        )}
      </Panel>
    </Page>
  );
}
