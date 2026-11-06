import { admin, json, requireUser } from '@/lib/server';

export const runtime = 'nodejs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KNOWN: Record<string, number> = { not_found: 404, suspended: 409, bad_rating: 400 };

/** POST { cardId, rating: 0..3, ms? } -> the card's new schedule. Scheduling happens in SQL (review_card), under a row lock. */
export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const b = await req.json().catch(() => null);
  if (typeof b?.cardId !== 'string' || !UUID.test(b.cardId) || !Number.isInteger(b?.rating) || b.rating < 0 || b.rating > 3) return json({ error: 'bad_request' }, 400);
  const ms = Number.isInteger(b.ms) && b.ms >= 0 && b.ms <= 600_000 ? b.ms : null;

  const { data, error } = await admin.rpc('review_card', { p_user: user.id, p_card: b.cardId, p_rating: b.rating, p_ms: ms });
  if (error) {
    const code = (error.message ?? '').trim();
    if (code in KNOWN) return json({ error: code }, KNOWN[code]);
    console.error('review_card failed', error.code);
    return json({ error: 'server_error' }, 500);
  }
  return json(data);
}
