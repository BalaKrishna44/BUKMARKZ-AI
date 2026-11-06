import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runEnrichment } from '@/lib/ai/worker';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Finishes enrichment for users who closed the tab. Schedule it every 5 minutes, e.g. in vercel.json:
// { "crons": [{ "path": "/api/cron/enrich", "schedule": "every-5-min cron expr" }] }  (Vercel sends CRON_SECRET as a Bearer token)
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return new Response('Unauthorized', { status: 401 });
  const r = await runEnrichment(createAdminClient(), { budgetMs: 50_000, batchSize: 30 });
  return Response.json(r);
}
