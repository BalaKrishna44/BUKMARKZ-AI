import { createClient } from '@/lib/supabase/server';
import { fetchCollections, fetchItems } from '@/lib/export/fetch';
import { netscapeHtml, type ExportItem } from '@/lib/export/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return Response.json({ error: 'Not signed in' }, { status: 401 });
  try {
    const cols = await fetchCollections(sb);
    const items: ExportItem[] = []; // folders nest, so items are grouped in memory (≈400 B each → 50k ≈ 20 MB)
    for await (const page of fetchItems(sb)) items.push(...page);
    const html = [...netscapeHtml(cols, items)].join('');
    return new Response(html, { headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="bukmarkz-bookmarks-${new Date().toISOString().slice(0, 10)}.html"`,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    } });
  } catch { return Response.json({ error: 'Export failed' }, { status: 500 }); }
}
