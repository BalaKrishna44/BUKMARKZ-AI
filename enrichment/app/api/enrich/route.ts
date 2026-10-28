import { after, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { enrichBookmark, enrichPending, llmFromEnv, supabaseRepo, type Deps } from '@/lib/enrichmentService';

export const runtime = 'nodejs';          // the fetcher uses node:http, node:dns and node:zlib
export const dynamic = 'force-dynamic';
export const maxDuration = 60;            // Vercel: raise on Pro if you want bigger batches

const safeEqual = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const bearer = (req: Request) => req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';

function deps(): Deps {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return { repo: supabaseRepo(db), llm: llmFromEnv(), log: (e) => console.log('[enrich]', JSON.stringify(e)) };   // logs ids and outcomes only, never page text
}

/** Supabase Database Webhook (INSERT on oneclist_items). Replies 202 at once; the work continues after the response. */
const WebhookBody = z.object({ type: z.string().optional(), record: z.object({ id: z.union([z.string(), z.number()]) }).passthrough() });
export async function POST(req: Request) {
  const secret = process.env.ENRICH_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'not configured' }, { status: 503 });
  if (!safeEqual(req.headers.get('x-webhook-secret') ?? '', secret)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = WebhookBody.safeParse(await req.json().catch(() => null));
  if (!body.success || (body.data.type && body.data.type !== 'INSERT')) return NextResponse.json({ ok: true, ignored: true }, { status: 202 });
  const id = String(body.data.record.id);
  after(async () => { try { await enrichBookmark({ id }, deps()); } catch (e) { console.error('[enrich] webhook job crashed', (e as Error).message); } });
  return NextResponse.json({ ok: true, queued: id }, { status: 202 });
}

/** Cron sweep (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`). Retries rows that failed or were never webhooked. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'not configured' }, { status: 503 });
  if (!safeEqual(bearer(req), secret)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limit = Number(new URL(req.url).searchParams.get('limit') ?? 10);
  const result = await enrichPending(deps(), { limit: Number.isFinite(limit) ? limit : 10, budgetMs: (maxDuration - 12) * 1000 });
  return NextResponse.json(result);
}
