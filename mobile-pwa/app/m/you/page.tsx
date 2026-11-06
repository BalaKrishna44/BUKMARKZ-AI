import { createClient } from '@/lib/supabase/server';
import { getUsage } from '@/lib/planLimits';
import { EnablePushButton } from '@/components/push/EnablePushButton';
import SignOut from './SignOut';

export const dynamic = 'force-dynamic';
const LABEL = { ask: 'Asks this month', mcp: 'AI-assistant calls', index: 'Indexed links' } as const;

export default async function YouPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  let usage: Awaited<ReturnType<typeof getUsage>> | null = null;
  try { usage = await getUsage(user.id); } catch { usage = null; }       // the page still renders if the gate is down
  return (
    <div className="space-y-3 pt-2">
      <h1 className="text-[22px] font-bold tracking-tight">You</h1>
      <p className="text-sm text-[#5b7266]">{user.email}</p>
      {usage ? (['ask', 'mcp', 'index'] as const).map(k => {
        const { used, limit } = usage!.features[k]; const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
        return (
          <div key={k} className="rounded-2xl border border-[#d6e8dc] bg-white p-3.5">
            <div className="flex justify-between text-sm"><b>{LABEL[k]}</b><span>{used}{limit ? ` / ${limit}` : ''}</span></div>
            {limit ? <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#d9f2e2]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={LABEL[k]}><div className="h-full bg-[#1a7f4e]" style={{ width: `${pct}%` }} /></div> : <p className="mt-1 text-xs text-[#5b7266]">No limit on your plan</p>}
          </div>);
      }) : <p className="text-sm text-[#5b7266]">Usage isn’t available right now.</p>}
      <div className="rounded-2xl border border-[#d6e8dc] bg-white p-3.5"><p className="mb-2 text-sm font-semibold">Price-drop alerts on this device</p><EnablePushButton /></div>
      <a href="/dashboard" className="block rounded-2xl border border-[#d6e8dc] bg-white p-3.5 text-sm font-medium">Open the full web app</a>
      <SignOut />
    </div>
  );
}
