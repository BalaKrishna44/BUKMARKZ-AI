import { admin, json, requireUser } from '@/lib/server';
import { buildSource, generateCards } from '@/lib/flashcards/generate';

export const runtime = 'nodejs';
export const maxDuration = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAILY = Number(process.env.FLASHCARD_ITEMS_PER_DAY ?? 30);          // cost guard: one Claude call per item
const STALE_MS = 5 * 60_000;

/** POST { itemId, force? } -> { created, total, dropped }. Cards come only from text we already hold (archive / OCR / notes). */
export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const body = await req.json().catch(() => null);
  const itemId = typeof body?.itemId === 'string' ? body.itemId : '';
  if (!UUID.test(itemId)) return json({ error: 'bad_item_id' }, 400);

  const { data: item } = await admin.from('oneclist_items')
    .select('id,title,note,summary,ai_status,cards_status,cards_claimed_at,full_markdown_content,ocr_extracted_text')
    .eq('id', itemId).eq('user_id', user.id).maybeSingle();
  if (!item) return json({ error: 'not_found' }, 404);
  if (item.ai_status === 'skipped_private') return json({ error: 'private_item', message: 'This bookmark is marked private, so it is never sent to AI.' }, 403);

  const { count: existing } = await admin.from('flashcards').select('id', { count: 'exact', head: true }).eq('item_id', itemId).eq('user_id', user.id);
  if ((existing ?? 0) > 0 && body?.force !== true) return json({ created: 0, total: existing, dropped: 0, already: true });

  const src = buildSource(item);
  if (!src) {
    await admin.from('oneclist_items').update({ cards_status: 'skipped', cards_error: 'not_enough_text' }).eq('id', itemId).eq('user_id', user.id);
    return json({ error: 'not_enough_text', message: 'Archive the page first (or add a note). There isn’t enough text to make good cards.' }, 422);
  }

  const since = new Date(Date.now() - 864e5).toISOString();
  const { count: today } = await admin.from('oneclist_items').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('cards_generated_at', since);
  if ((today ?? 0) >= DAILY) return json({ error: 'daily_limit', limit: DAILY }, 429);

  // Atomic claim: two taps on "Make cards" produce one Claude call. A claim older than 5 minutes is treated as crashed.
  const stale = new Date(Date.now() - STALE_MS).toISOString();
  const { data: claimed } = await admin.from('oneclist_items')
    .update({ cards_status: 'processing', cards_claimed_at: new Date().toISOString(), cards_error: null })
    .eq('id', itemId).eq('user_id', user.id).or(`cards_status.neq.processing,cards_claimed_at.lt.${stale}`).select('id');
  if (!claimed?.length) return json({ error: 'in_progress' }, 409);

  try {
    const { cards, dropped } = await generateCards(String(item.title ?? ''), src.text);
    let created = 0;
    if (cards.length) {
      const { data, error } = await admin.from('flashcards')
        .upsert(cards.map((c) => ({ user_id: user.id, item_id: itemId, question: c.question, answer: c.answer, evidence: c.evidence })), { onConflict: 'item_id,q_hash', ignoreDuplicates: true })
        .select('id');
      if (error) throw new Error('db');
      created = data?.length ?? 0;
    }
    await admin.from('oneclist_items').update({ cards_status: cards.length ? 'done' : 'skipped', cards_generated_at: new Date().toISOString(), cards_error: cards.length ? null : 'nothing_teachable' }).eq('id', itemId).eq('user_id', user.id);
    const { count: total } = await admin.from('flashcards').select('id', { count: 'exact', head: true }).eq('item_id', itemId).eq('user_id', user.id);
    return json({ created, total: total ?? created, dropped: dropped.length, source: src.from });
  } catch (e) {
    console.error('flashcard generation failed', (e as Error)?.message?.slice(0, 80));           // no content in logs
    await admin.from('oneclist_items').update({ cards_status: 'failed', cards_error: 'model_error' }).eq('id', itemId).eq('user_id', user.id);
    return json({ error: 'generation_failed' }, 502);
  }
}
