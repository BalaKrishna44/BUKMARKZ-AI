import { cache } from 'react';

export interface SharedSessionData { id: string; title: string; summary: string | null; tab_count: number; created_at: string; tabs: { url: string; title: string; favicon: string | null }[] }
export const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const httpUrl = (v: unknown) => { try { const u = new URL(String(v)); return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null; } catch { return null; } };
const httpsUrl = (v: unknown) => { const u = httpUrl(v); return u && u.startsWith('https:') ? u : null; };

/** Anonymous, link-only read through get_shared_session() (028_sessions.sql). Re-validates every field: the row is user-supplied content. */
export const getSharedSession = cache(async (id: string): Promise<SharedSessionData | null> => {
  if (!SESSION_ID_RE.test(id)) return null;
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/get_shared_session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ p_id: id.toLowerCase() }),
      next: { revalidate: 60, tags: [`session:${id.toLowerCase()}`] },
    });
    if (!res.ok) return null;
    const j = await res.json(); const row = Array.isArray(j) ? j[0] : j;
    if (!row || !Array.isArray(row.tabs)) return null;
    const tabs = (row.tabs as any[]).slice(0, 200).flatMap((t) => {
      const url = httpUrl(t?.url); return url ? [{ url, title: String(t?.title ?? '').slice(0, 200) || new URL(url).hostname, favicon: httpsUrl(t?.favicon) }] : [];
    });
    return { id: String(row.id), title: String(row.title ?? '').slice(0, 120), summary: typeof row.summary === 'string' ? row.summary.slice(0, 600) : null, tab_count: tabs.length, created_at: String(row.created_at ?? ''), tabs };
  } catch { return null; }
});
