import { getPublicStack } from '@/lib/stacks/public';
import { renderCard } from '@/lib/embed/card';
import { validSlug } from '@/lib/stacks/slug';

/**
 * GET /embed/<slug>/card.svg?theme=dark|light&limit=1..8   -> a self-contained SVG card for GitHub READMEs, Notion, emails, wikis.
 *
 * Why an image: GitHub (and many docs tools) strip <iframe>, but they show images. GitHub also re-serves images through its own proxy and
 * blocks scripts, external fonts and external images inside SVGs, so this file is plain shapes + text with system fonts: nothing external, nothing that can run.
 * Every string from the database is XML-escaped and cut to length (a stack title cannot add elements). The watermark is drawn into the image itself.
 */
export const revalidate = 300;
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const slug = (await ctx.params).id.toLowerCase();
  const stack = validSlug(slug) ? await getPublicStack(slug) : null;
  if (!stack) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=60' } });
  const q = new URL(req.url).searchParams, n = Number(q.get('limit'));
  const svg = renderCard(stack, q.get('theme') === 'light' ? 'light' : 'dark', Number.isInteger(n) && n >= 1 && n <= 8 ? n : 5);
  return new Response(svg, { headers: {
    'content-type': 'image/svg+xml; charset=utf-8',
    'cache-control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=3600',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",   // if someone opens the SVG directly, it cannot run anything
    'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'cross-origin',
  } });
}
