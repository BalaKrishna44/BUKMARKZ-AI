import { createClient } from '@/lib/supabase/server';
import { fetchCollections, fetchItems } from '@/lib/export/fetch';
import { collectionPaths, jsonHeader, jsonItem } from '@/lib/export/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const sb = await createClient(); // user session → RLS guarantees only their rows
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return Response.json({ error: 'Not signed in' }, { status: 401 });

  let paths: Map<string, string[]>;
  try { paths = collectionPaths(await fetchCollections(sb)); } catch { return Response.json({ error: 'Export failed' }, { status: 500 }); }

  const enc = new TextEncoder();
  const pages = fetchItems(sb);
  let first = true, started = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      try {
        if (!started) { started = true; ctrl.enqueue(enc.encode(jsonHeader())); }
        const { value, done } = await pages.next();
        if (done) { ctrl.enqueue(enc.encode(']}')); ctrl.close(); return; }
        ctrl.enqueue(enc.encode(value.map((i) => (first ? ((first = false), '') : ',') + jsonItem(i, paths)).join('')));
      } catch (e) { ctrl.error(e); }
    },
    cancel() { void pages.return(undefined); },
  });
  return new Response(body, { headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="bukmarkz-export-${new Date().toISOString().slice(0, 10)}.json"`,
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  } });
}
