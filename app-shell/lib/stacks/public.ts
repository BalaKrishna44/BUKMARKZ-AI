import { cache } from 'react';
import { isTheme, type ThemeName } from './themes';

export interface PublicStack {
  slug: string; title: string; description: string | null; theme: ThemeName; handle: string;
  created_at: string; updated_at: string; fork_count: number;
  avatar: string | null; follower_count: number; remix_count: number;
  remixed_from: { slug: string; title: string; handle: string } | null;
  items: { title: string; url: string; blurb: string | null }[];
}
export const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://bukmarkz.com').replace(/\/$/, '');

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/**
 * Avatars are user-controlled URLs that the OG renderer and the page would fetch/embed, so only our own Supabase public
 * `avatars` bucket is accepted (https, same origin, no credentials, no path tricks). Anything else -> null -> initial letter.
 */
export function safeAvatar(raw: unknown, supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): string | null {
  if (typeof raw !== 'string' || raw.length > 500 || !supabaseUrl) return null;
  try {
    const u = new URL(raw), base = new URL(supabaseUrl);
    if (u.protocol !== 'https:' || u.origin !== base.origin || u.username || u.password) return null;
    if (!u.pathname.startsWith('/storage/v1/object/public/avatars/') || u.pathname.includes('..') || u.pathname.includes('//', 1)) return null;
    return u.toString();
  } catch { return null; }
}

function parseCredit(v: any): PublicStack['remixed_from'] {
  const slug = str(v?.slug, 60), handle = str(v?.handle, 20);
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && /^[a-z0-9_]{3,20}$/.test(handle) ? { slug, title: str(v?.title, 80), handle } : null;
}

/** Defensive: treat the RPC result as untrusted shape. Returns null for anything that is not a well-formed stack. */
export function parseStack(raw: unknown): PublicStack | null {
  const r = raw as Record<string, any> | null;
  if (!r || typeof r !== 'object' || typeof r.slug !== 'string' || typeof r.title !== 'string' || typeof r.handle !== 'string') return null;
  const items = (Array.isArray(r.items) ? r.items : []).flatMap((i: any) => {
    const url = str(i?.url, 2048);
    return /^https?:\/\//i.test(url) ? [{ title: str(i?.title, 200) || url, url, blurb: str(i?.blurb, 200) || null }] : [];      // never render javascript:/data: links
  }).slice(0, 50);
  return { slug: r.slug, title: r.title.slice(0, 80), description: str(r.description, 280) || null, theme: isTheme(r.theme) ? r.theme : 'mint', handle: r.handle,
    created_at: str(r.created_at, 40), updated_at: str(r.updated_at, 40), fork_count: Number.isFinite(r.fork_count) ? r.fork_count : 0,
    avatar: safeAvatar(r.avatar_url), follower_count: count(r.follower_count), remix_count: count(r.remix_count), remixed_from: parseCredit(r.remixed_from), items };
}

/**
 * Anonymous read through the get_public_stack() RPC. Plain fetch (no cookies) so the page can be cached/ISR'd and the same
 * call works in the edge runtime of opengraph-image. React cache() dedupes the three callers within one request;
 * revalidateTag(`stack:<slug>`) refreshes it when the owner edits or unpublishes.
 */
export const getPublicStack = cache(async (slug: string): Promise<PublicStack | null> => {
  if (!/^[a-z0-9-]{3,60}$/i.test(slug)) return null;
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/get_public_stack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ p_slug: slug }),
      next: { revalidate: 300, tags: [`stack:${slug.toLowerCase()}`] },
    });
    if (!res.ok) return null;
    return parseStack(await res.json());
  } catch { return null; }
});
