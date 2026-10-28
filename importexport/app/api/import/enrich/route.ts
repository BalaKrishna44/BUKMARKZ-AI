import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runEnrichment } from '@/lib/ai/worker';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** POST { jobId } → works for ~40s, returns progress. The modal calls it in a loop until remaining = 0. */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Not signed in' }, { status: 401 });
  const { jobId } = (await req.json().catch(() => ({}))) as { jobId?: string };
  if (!jobId || !/^[0-9a-f-]{36}$/i.test(jobId)) return Response.json({ error: 'jobId required' }, { status: 400 });

  const admin = createAdminClient();
  const run = await runEnrichment(admin, { userId: user.id, jobId, budgetMs: 45_000 });
  const { data } = await admin.rpc('ai_progress', { p_user: user.id, p_job: jobId });
  const p = Array.isArray(data) ? data[0] : data;
  const total = p?.total ?? 0, done = p?.done ?? 0, failed = p?.failed ?? 0;
  return Response.json({ total, done, failed, remaining: total - done - failed, lastError: run.lastError });
}
