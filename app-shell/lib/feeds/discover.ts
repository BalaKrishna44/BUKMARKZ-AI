const httpUrl = (v?: string | null, base?: string) => { try { const u = new URL(v ?? '', base); return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null; } catch { return null; } };

/** If the user pasted a site URL instead of a feed URL, look for <link rel="alternate" type="application/rss+xml|atom+xml">. */
export function discoverFeedUrl(html: string, pageUrl: string): string | null {
  const tags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const t of tags) {
    if (!/rel=["']?alternate/i.test(t) || !/type=["']?application\/(rss|atom)\+xml/i.test(t)) continue;
    const href = t.match(/href=["']([^"']+)["']/i)?.[1];
    const u = httpUrl(href, pageUrl);
    if (u) return u;
  }
  return null;
}
