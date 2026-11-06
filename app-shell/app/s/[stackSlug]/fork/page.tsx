import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { INTENT_COOKIE } from '@/app/actions/remix-constants';
import { AutoRemix, RemixButton } from '../RemixButton';
import { getPublicStack } from '@/lib/stacks/public';

export const dynamic = 'force-dynamic';                        // reads the session
export const metadata: Metadata = { title: 'Fork stack', robots: { index: false, follow: false } };

/**
 * GET is read-only (safe to link to); the copy itself happens in a server action behind a button, so a third-party page
 * cannot make a signed-in visitor fork anything just by embedding this URL.
 */
export default async function ForkPage({ params, searchParams }: { params: Promise<{ stackSlug: string }>; searchParams: Promise<{ error?: string; action?: string }> }) {
  const { stackSlug } = await params;
  const { error, action } = await searchParams;
  const stack = await getPublicStack(stackSlug);
  if (!stack) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/s/${stack.slug}/fork${action === 'remix' ? '?action=remix' : ''}`)}`);          // comes straight back here after sign-in

  // Came back from sign-up with a remix intent set by THIS browser -> run it now. Any other visit just shows the button.
  const resume = action === 'remix' && (await cookies()).get(INTENT_COOKIE)?.value === stack.slug;

  return (
    <main className="grid min-h-screen place-items-center bg-[#f1f9f4] p-6 text-[#33443b]">
      <div className="w-full max-w-md rounded-3xl border border-[#d8eedf] bg-white p-7 text-center shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#1a7f4e]">Fork a stack</p>
        <h1 className="mt-2 text-balance text-2xl font-bold text-[#10261c]">{stack.title}</h1>
        <p className="mt-2 text-sm text-[#4b5c53]">by @{stack.handle} · {stack.items.length} link{stack.items.length === 1 ? '' : 's'}</p>
        <p className="mt-4 text-sm leading-relaxed">We’ll add these links to your Bukmarkz, tagged <code className="rounded bg-[#e6f4ec] px-1.5 py-0.5 text-[#0f6b3e]">stack-{stack.slug}</code>. Links you already have are skipped.</p>
        {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">Something went wrong. Please try again.</p>}
        <div className="mt-6">{resume ? <AutoRemix slug={stack.slug} /> : <RemixButton slug={stack.slug} label="Add to my Bukmarkz" />}</div>
        <Link href={`/s/${stack.slug}`} className="mt-4 inline-block text-sm text-[#1a7f4e] hover:underline">← Back to the stack</Link>
      </div>
    </main>
  );
}
