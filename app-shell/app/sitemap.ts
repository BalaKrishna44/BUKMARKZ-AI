import type { MetadataRoute } from 'next';
import { createClient } from '@supabase/supabase-js';
import { SITE, sitemapEntries } from '@/lib/seo/stack-seo';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const fixed: MetadataRoute.Sitemap = ['', '/features', '/pricing', '/download', '/signup', '/switch/raindrop', '/privacy', '/terms'].map((p) => ({ url: SITE + p, changeFrequency: 'weekly', priority: p === '' ? 1 : 0.8 }));
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const { data } = await sb.rpc('list_indexable_stacks', { p_limit: 5000, p_offset: 0 });
    return [...fixed, ...sitemapEntries((data ?? []) as { slug: string; updated_at: string }[])];
  } catch { return fixed; }   // never fail the sitemap because the database is slow
}
