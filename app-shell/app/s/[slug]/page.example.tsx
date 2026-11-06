// Merge into your existing app/s/[slug]/page.tsx (keep your current UI). Only the SEO parts are shown.
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { safeJson, stackJsonLd, stackMetadata, STACK_LINK_REL, type PublicStack } from '@/lib/seo/stack-seo';

async function load(slug: string) {
  const { data } = await (await createClient()).rpc('get_public_stack', { p_slug: slug });
  return (data as PublicStack | null) ?? null;
}
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return stackMetadata(await load((await params).slug)) as Metadata;
}
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const stack = await load((await params).slug);
  if (!stack) return null; // your existing notFound() handling
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJson(stackJsonLd(stack)) }} />
      {/* ...your existing page; every outbound item link must carry: */}
      {stack.items.map((i) => <a key={i.url} href={i.url} rel={STACK_LINK_REL} target="_blank">{i.title}</a>)}
    </>
  );
}
