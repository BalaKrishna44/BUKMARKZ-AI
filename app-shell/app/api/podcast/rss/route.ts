import { renderFeed } from '@/lib/podcast/feed';

export const runtime = 'nodejs';

/**
 * GET /api/podcast/rss?token=<your private token>   ->  application/rss+xml
 * Same feed as /api/podcast/<token>/feed.xml. Prefer that path form: tokens in query strings end up in more logs.
 * Subscribe in Apple Podcasts (Library > Follow a Show by URL) or Pocket Casts (paste the URL). Spotify cannot follow private feeds.
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token') ?? '';
  return renderFeed(req, token, `${process.env.APP_URL}/api/podcast/rss?token=${encodeURIComponent(token)}`);
}
