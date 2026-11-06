import Parser from 'rss-parser';
import { createHash } from 'node:crypto';
import { safeFetch } from '../ssrf';
import { discoverFeedUrl } from './discover';
import { cleanHtml, excerptOf, htmlToText } from '../html';

export interface FeedState { url: string; etag?: string | null; last_modified?: string | null }
export interface NormalizedEntry {
  guid: string; url: string; title: string; author: string | null; published_at: string;
  content_html: string; content_text: string; excerpt: string; image_url: string | null;
}
export type FetchResult =
  | { kind: 'not_modified' }
  | { kind: 'ok'; title: string | null; siteUrl: string | null; entries: NormalizedEntry[]; etag: string | null; lastModified: string | null }
  | { kind: 'error'; error: string; retryAfterSec?: number };

const parser = new Parser({
  customFields: { item: [['content:encoded', 'contentEncoded'], ['media:content', 'mediaContent', { keepArray: true }], ['media:thumbnail', 'mediaThumb']] },
  timeout: 15000,
});
const MAX_ENTRIES = 100;

const httpUrl = (v?: string | null, base?: string) => { try { const u = new URL(v ?? '', base); return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null; } catch { return null; } };

export function normalizeItem(item: any, feedUrl: string): NormalizedEntry | null {
  const url = httpUrl(item.link, feedUrl) ?? httpUrl(item.guid, feedUrl);
  if (!url) return null;                                   // an entry without a usable http(s) link cannot be saved
  const raw = String(item.contentEncoded ?? item.content ?? item.summary ?? item['content:encoded'] ?? '');
  const html = cleanHtml(raw, url);
  const text = htmlToText(html);
  const guid = String(item.guid || item.id || url || '') || createHash('sha1').update((item.title ?? '') + (item.isoDate ?? '')).digest('hex');
  const d = new Date(item.isoDate ?? item.pubDate ?? Date.now());
  const media = item.mediaContent?.find?.((m: any) => m?.$?.url)?.$?.url ?? item.mediaThumb?.$?.url ?? item.enclosure?.url;
  const imgInBody = html.match(/<img[^>]+src="([^"]+)"/)?.[1];
  return {
    guid: guid.slice(0, 500), url,
    title: htmlToText(String(item.title ?? '')).slice(0, 500) || url,
    author: item.creator || item.author ? String(item.creator ?? item.author).slice(0, 200) : null,
    published_at: (Number.isNaN(+d) || +d > Date.now() + 864e5 ? new Date() : d).toISOString(),   // future-dated => now
    content_html: html.slice(0, 200_000),
    content_text: text.slice(0, 100_000),
    excerpt: excerptOf(htmlToText(String(item.contentSnippet ?? item.summary ?? '')) || text),
    image_url: httpUrl(media, url) ?? httpUrl(imgInBody, url),
  };
}

export async function fetchFeed(feed: FeedState): Promise<FetchResult> {
  try {
    const res = await safeFetch(feed.url, {
      maxBytes: 5 * 1024 * 1024,
      headers: {
        accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
        ...(feed.etag ? { 'if-none-match': feed.etag } : {}),
        ...(feed.last_modified ? { 'if-modified-since': feed.last_modified } : {}),
      },
    });
    if (res.status === 304) return { kind: 'not_modified' };
    if (res.status === 429 || res.status === 503) return { kind: 'error', error: `HTTP ${res.status}`, retryAfterSec: Math.min(Number(res.headers.get('retry-after')) || 3600, 86400) };
    if (res.status < 200 || res.status >= 300) return { kind: 'error', error: `HTTP ${res.status}` };
    const parsed = await parser.parseString(new TextDecoder('utf-8').decode(res.body));
    const entries = (parsed.items ?? []).slice(0, MAX_ENTRIES).map((i) => normalizeItem(i, res.url)).filter((e): e is NormalizedEntry => !!e);
    return { kind: 'ok', title: parsed.title?.slice(0, 300) ?? null, siteUrl: httpUrl(parsed.link), entries, etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') };
  } catch (e: any) {
    return { kind: 'error', error: String(e?.message ?? e).slice(0, 300) };
  }
}

export { discoverFeedUrl };
