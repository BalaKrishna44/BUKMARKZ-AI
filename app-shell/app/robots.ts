import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/seo/stack-seo';
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', allow: ['/', '/s/'], disallow: ['/dashboard', '/api/', '/login', '/settings'] }], sitemap: `${SITE}/sitemap.xml` };
}
