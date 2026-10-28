import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { AnthropicLlm, BookmarkOrganizer, SupabaseOrganizerDb } from '@/lib/ai/taxonomy';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** POST { reuseTaxonomy?: boolean, overwrite?: boolean } → SSE: progress | done | error. Resumable: re-run to finish. */
export async function POST(req: NextRequest) {
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return Response.json({ error: 'Not signed in' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { reuseTaxonomy?: boolean; overwrite?: boolean };
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (e: string, d: unknown) => { try { ctrl.enqueue(enc.encode(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`)); } catch {} };
      try {
        const report = await new BookmarkOrganizer(new AnthropicLlm(), new SupabaseOrganizerDb(createAdminClient()))
          .run(user.id, { reuseTaxonomy: !!body.reuseTaxonomy, overwrite: !!body.overwrite, onProgress: (p) => send('progress', p) });
        send('done', report);
      } catch (e) { send('error', { message: 'Organising stopped part-way. Run it again to continue; finished items are kept.' }); console.error(e); }
      finally { try { ctrl.close(); } catch {} }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' } });
}
