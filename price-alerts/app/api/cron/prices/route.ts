import { admin, isCron, json } from '@/lib/server';

/** Daily (Vercel Cron): drop observations older than 120 days and alert-log rows older than a year. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  if (!isCron(req)) return json({ error: 'unauthorized' }, 401);
  const { data, error } = await admin.rpc('price_prune');
  return error ? json({ error: 'internal' }, 500) : json({ pruned: data });
}
