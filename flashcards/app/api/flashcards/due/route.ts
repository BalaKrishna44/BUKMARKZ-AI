import { admin, json, requireUser } from '@/lib/server';
import { localDay, startOfLocalDay, streak, validTimeZone } from '@/lib/flashcards/sm2';

export const runtime = 'nodejs';
const NEW_PER_DAY = Number(process.env.FLASHCARD_NEW_PER_DAY ?? 10);
const COLS = 'id,question,answer,evidence,state,ease,interval_days,reps,lapses,item_id,oneclist_items(title,url)';

/** GET ?limit=20&tz=Asia/Kolkata -> { cards, stats }. Due reviews first (oldest due first), then new cards up to today's allowance. */
export async function GET(req: Request) {
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const u = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(u.searchParams.get('limit') ?? '20', 10) || 20, 1), 50);
  const tzRaw = u.searchParams.get('tz'); const tz = validTimeZone(tzRaw) ? tzRaw : 'UTC';
  const now = new Date(); const dayStart = startOfLocalDay(tz, now);

  const [dueRows, dueCount, newToday, newTotal, days, total] = await Promise.all([
    admin.from('flashcards').select(COLS).eq('user_id', user.id).in('state', ['learning', 'review']).lte('due_at', now.toISOString()).order('due_at').limit(limit),
    admin.from('flashcards').select('id', { count: 'exact', head: true }).eq('user_id', user.id).in('state', ['learning', 'review']).lte('due_at', now.toISOString()),
    admin.from('card_reviews').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('was_new', true).gte('reviewed_at', dayStart.toISOString()),
    admin.from('flashcards').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('state', 'new'),
    admin.rpc('review_days', { p_user: user.id, p_tz: tz, p_days: 60 }),
    admin.from('flashcards').select('id', { count: 'exact', head: true }).eq('user_id', user.id).neq('state', 'suspended'),
  ]);
  if (dueRows.error) return json({ error: 'server_error' }, 500);

  const cards: unknown[] = [...(dueRows.data ?? [])];
  const newLeft = Math.max(0, NEW_PER_DAY - (newToday.count ?? 0));
  if (cards.length < limit && newLeft > 0) {
    const { data } = await admin.from('flashcards').select(COLS).eq('user_id', user.id).eq('state', 'new').order('created_at').limit(Math.min(newLeft, limit - cards.length));
    cards.push(...(data ?? []));
  }
  const dayList = ((days.data ?? []) as { day: string }[]).map((d) => d.day);
  return json({
    cards: cards.map((c: any) => ({ ...c, item: { id: c.item_id, title: c.oneclist_items?.title ?? '', url: c.oneclist_items?.url ?? '' }, oneclist_items: undefined })),
    stats: { due: dueCount.count ?? 0, newAvailable: Math.min(newLeft, newTotal.count ?? 0), total: total.count ?? 0, streak: streak(dayList, localDay(tz, now)), reviewedToday: dayList[0] === localDay(tz, now) },
  }, 200, { 'cache-control': 'private, no-store' });
}
