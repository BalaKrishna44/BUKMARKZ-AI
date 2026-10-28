import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { BookmarkParser } from '@/lib/import/parser';

export const runtime = 'nodejs';
export const maxDuration = 300; // lower on plans that cap it; large imports are resumable only via re-upload (duplicates are skipped)

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ITEMS = Number(process.env.IMPORT_MAX_ITEMS ?? 20_000);
const BATCH = 500;

/**
 * POST multipart/form-data { file, ai: "true"|"false" }
 * Response: text/event-stream with events  parsed | progress | done | error
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Not signed in' }, { status: 401 });

  let form: FormData;
  try { form = await req.formData(); } catch { return Response.json({ error: 'Expected multipart form data' }, { status: 400 }); }
  const file = form.get('file');
  if (!(file instanceof File)) return Response.json({ error: 'No file uploaded' }, { status: 400 });
  if (file.size === 0) return Response.json({ error: 'File is empty' }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: 'File is larger than 10 MB' }, { status: 413 });
  const wantAi = form.get('ai') === 'true';

  const parsed = new BookmarkParser({ maxItems: MAX_ITEMS }).parse(await file.text(), file.name);
  if (!parsed.items.length) {
    return Response.json({ error: parsed.warnings[0] ?? 'No importable bookmarks found', skipped: parsed.skipped }, { status: 422 });
  }

  const admin = createAdminClient();
  const { data: job, error: jobErr } = await admin.from('import_jobs').insert({
    user_id: user.id, source: parsed.sourceGuess, filename: file.name.slice(0, 200), total: parsed.items.length,
    skipped: parsed.skipped.reduce((n, s) => n + s.count, 0), ai_enabled: wantAi && !!process.env.ANTHROPIC_API_KEY,
  }).select('id, ai_enabled').single();
  if (jobErr || !job) return Response.json({ error: 'Could not start import' }, { status: 500 });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (event: string, data: unknown) => { try { ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { /* client went away */ } };
      let inserted = 0, duplicates = 0;
      try {
        send('parsed', { jobId: job.id, total: parsed.items.length, source: parsed.sourceGuess, format: parsed.format, skipped: parsed.skipped, warnings: parsed.warnings, ai: job.ai_enabled });
        for (let i = 0; i < parsed.items.length; i += BATCH) {
          if (req.signal.aborted) throw new Error('cancelled');
          const slice = parsed.items.slice(i, i + BATCH).map((b) => ({
            url: b.url, url_key: b.urlKey, title: b.title, note: b.note, tags: b.tags, folder: b.folder, created_at: b.createdAt,
          }));
          const { data, error } = await admin.rpc('import_bookmarks_batch', {
            p_user: user.id, p_job: job.id, p_source: parsed.sourceGuess ?? parsed.format, p_ai: job.ai_enabled, p_items: slice,
          });
          if (error) throw new Error(error.message);
          const row = Array.isArray(data) ? data[0] : data;
          inserted += row?.inserted ?? 0; duplicates += row?.duplicates ?? 0;
          send('progress', { processed: Math.min(i + BATCH, parsed.items.length), total: parsed.items.length, inserted, duplicates });
        }
        await admin.from('import_jobs').update({ status: 'done' }).eq('id', job.id);
        send('done', { jobId: job.id, inserted, duplicates, total: parsed.items.length, ai: job.ai_enabled });
      } catch (e) {
        const msg = (e as Error).message;
        await admin.from('import_jobs').update({ status: 'failed', error: msg.slice(0, 500) }).eq('id', job.id);
        // Rows already inserted stay (they are valid); re-uploading the same file resumes safely because duplicates are skipped.
        send('error', { message: msg === 'cancelled' ? 'Import cancelled' : 'Import failed part-way. Re-upload the same file to finish; already imported bookmarks are skipped.', inserted });
      } finally { try { ctrl.close(); } catch {} }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
}
