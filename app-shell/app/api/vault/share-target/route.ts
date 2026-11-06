import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server'; // your existing server helper

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://bukmarkz.com').replace(/\/$/, '');
const URL_RE = /https?:\/\/[^\s<>"']+/i;

function cleanUrl(raw?: string | null): string | null {
  const m = raw?.match(URL_RE)?.[0]; if (!m) return null;
  try {
    const u = new URL(m.replace(/[)\].,;:!?'"]+$/, ''));
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString().slice(0, 2048) : null;
  } catch { return null; }
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const title = (sp.get('title') ?? '').slice(0, 300);
  const url = cleanUrl(sp.get('url')) ?? cleanUrl(sp.get('text')) ?? cleanUrl(title);
  if (!url) return NextResponse.redirect(new URL('/m/save', SITE));
  const target = new URL('/m/save', SITE);
  target.searchParams.set('share_url', url);
  if (title && title !== url) target.searchParams.set('share_title', title);
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) { const l = new URL('/login', SITE); l.searchParams.set('next', target.pathname + target.search); return NextResponse.redirect(l); }
  return NextResponse.redirect(target);
}
