import { admin, json, requireUser } from '@/lib/server';
import { checkUrl } from '@/lib/url';

export const runtime = 'nodejs';

/** 1-click save: feed entry -> oneclist_items. Idempotent (same URL saves once per user). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'bad_request' }, 400);

  const { data: e } = await admin.from('feed_entries').select('*').eq('id', id).eq('user_id', user.id).maybeSingle();
  if (!e) return json({ error: 'not_found' }, 404);
  if (e.saved_item_id) return json({ itemId: e.saved_item_id, alreadySaved: true });

  const c = checkUrl(e.url);
  if (!c.ok) return json({ error: 'bad_entry_url' }, 422);

  const { data: existing } = await admin.from('oneclist_items').select('id, content_text').eq('user_id', user.id).eq('url_key', c.key).maybeSingle();
  let itemId = existing?.id as string | undefined;

  if (itemId) {
    if (!existing?.content_text) await admin.from('oneclist_items').update({ content_text: e.content_text }).eq('id', itemId).eq('user_id', user.id);
  } else {
    const { data: item, error } = await admin.from('oneclist_items').insert({
      user_id: user.id, url: c.url, url_key: c.key, title: e.title, summary: e.excerpt, content_text: e.content_text,
      source: 'rss', status: 'bookmark', ai_status: 'pending',          // existing enrichment pipeline adds tags + embedding
    }).select('id').single();
    if (error || !item) return json({ error: 'db_error' }, 500);
    itemId = item.id;
  }
  await admin.from('feed_entries').update({ saved_item_id: itemId, read_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id);
  return json({ itemId, alreadySaved: false }, 201);
}
