import { admin, json, requireUser } from '@/lib/server';
import { checkUrl, cleanText } from '@/lib/url';
import { checkFeatureLimit, refundFeature } from '@/lib/planLimits';
import { gateErrorResponse } from '@/lib/http/limit';

export const runtime = 'nodejs';
const NO_STORE = { 'cache-control': 'no-store' };

/**
 * POST /api/save  { url, title?, note? }  -> 201 { id } | 200 { id, alreadySaved: true } | 4xx/5xx { error }
 * The mobile "Save a link" path (share sheet / + button). Same rules as the other save paths: http(s) only, one row per
 * canonical url_key per user, counts against the plan's indexed-links limit only when a NEW row is created, and the
 * existing enrichment pipeline (ai_status 'pending') adds tags, summary and the embedding afterwards.
 * Cookie sessions are accepted, so the request must be JSON (a cross-site form cannot send that without a preflight)
 * and, when the browser sends an Origin, it must be this site.
 */
export async function POST(req: Request) {
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return json({ error: 'bad_request' }, 415, NO_STORE);
  const origin = req.headers.get('origin');
  if (origin && !req.headers.get('authorization')) { try { if (new URL(origin).host !== new URL(req.url).host) return json({ error: 'forbidden' }, 403, NO_STORE); } catch { return json({ error: 'forbidden' }, 403, NO_STORE); } }

  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401, NO_STORE);

  const raw = await req.text();
  if (raw.length > 20_000) return json({ error: 'too_large' }, 413, NO_STORE);
  let b: { url?: unknown; title?: unknown; note?: unknown };
  try { b = JSON.parse(raw); } catch { return json({ error: 'bad_request' }, 400, NO_STORE); }
  if (!b || typeof b !== 'object') return json({ error: 'bad_request' }, 400, NO_STORE);

  const c = checkUrl(b.url);
  if (!c.ok) return json({ error: 'bad_url', reason: c.reason }, 422, NO_STORE);
  const title = cleanText(b.title, 500) || null, note = cleanText(b.note, 2000) || null;

  const { data: existing } = await admin.from('oneclist_items').select('id').eq('user_id', user.id).eq('url_key', c.key).maybeSingle();
  if (existing) return json({ id: existing.id, alreadySaved: true }, 200, NO_STORE);

  try { await checkFeatureLimit(user.id, 'index'); }
  catch (e) { const r = gateErrorResponse(e); if (r) return r; throw e; }

  const { data, error } = await admin.from('oneclist_items').insert({
    user_id: user.id, url: c.url, url_key: c.key, title, note, source: 'mobile', status: 'bookmark', ai_status: 'pending',
  }).select('id').single();
  if (error || !data) {
    await refundFeature(user.id, 'index');                                   // we failed after the check passed: give the unit back
    if (error?.code === '23505') {                                           // lost a race with another save of the same page
      const { data: again } = await admin.from('oneclist_items').select('id').eq('user_id', user.id).eq('url_key', c.key).maybeSingle();
      return json({ id: again?.id ?? null, alreadySaved: true }, 200, NO_STORE);
    }
    console.error('mobile save failed', error?.code);                        // never log the URL or note
    return json({ error: 'server_error' }, 500, NO_STORE);
  }
  return json({ id: data.id }, 201, NO_STORE);
}
