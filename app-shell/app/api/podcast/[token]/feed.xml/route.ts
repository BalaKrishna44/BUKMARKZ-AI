import { renderFeed } from '@/lib/podcast/feed';

export const runtime = 'nodejs';

/** Private RSS. The token in the URL is the credential: podcast apps cannot send headers. */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  return renderFeed(req, token, `${process.env.APP_URL}/api/podcast/${token}/feed.xml`);
}
