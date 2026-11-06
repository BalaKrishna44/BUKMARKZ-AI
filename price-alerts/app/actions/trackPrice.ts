'use server';

import { createClient } from '@/lib/supabase/server';
import { alertDb, defaultChannels } from '@/lib/alerts/default';
import { trackPrice as run, type TrackResult } from '@/lib/prices/track';

/**
 * Server Action: "Check price now" for one of the signed-in user's saved products.
 *   <form action={trackPriceAction}><input type="hidden" name="item_id" value={item.id} /> ...</form>
 *
 * The user is read from the session (never from the form). The item is loaded with the user's own Supabase client, so RLS decides
 * whether it is theirs. The price is logged to price_observations (the existing price history; observer = this user, source 'crawler')
 * by the service role through price_observe(), which only accepts products the user is watching and throttles to one check per product per 30 minutes.
 */
export type TrackState = TrackResult | null;

export async function trackPriceAction(_prev: TrackState, formData: FormData): Promise<TrackState> {
  const itemId = String(formData.get('item_id') ?? '');
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'not_found' };
  try {
    return await run({
      db: alertDb, channels: defaultChannels(),
      getItem: async (_u, id) => { const { data } = await supabase.from('oneclist_items').select('url').eq('id', id).maybeSingle(); return data ? { url: data.url as string } : null; },
      fetchPage: async (url) => {
        const { safeFetch } = await import('@/lib/ssrf');                       // SSRF-safe, size- and time-bounded, redirects re-validated per hop
        const r = await safeFetch(url, { maxBytes: 1_500_000, timeoutMs: 6_000, headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'BukmarkzBot/1.0 (+https://bukmarkz.com)' } });
        return { status: r.status, contentType: r.headers.get('content-type') ?? '', body: r.body, finalUrl: r.url };
      },
    }, user.id, itemId);
  } catch (e) {
    console.error('trackPrice failed', (e as Error).message);                   // message only, never URLs or payloads
    return { ok: false, reason: 'server' };
  }
}
