import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SITE, getPublicStack } from '@/lib/stacks/public';
import { themeOf } from '@/lib/stacks/themes';
import StackActions from '@/components/stacks/StackActions';
import SharedSession from '@/components/sessions/SharedSession';
import { getSharedSession, SESSION_ID_RE } from '@/lib/sessions/public';

// Public + cacheable: no cookies are read here, so this page is ISR'd (the fork flow lives on its own dynamic route).
export const revalidate = 300;

type Props = { params: Promise<{ stackSlug: string }> };

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { stackSlug } = await params;
  if (SESSION_ID_RE.test(stackSlug)) {                                 // /s/<uuid> is a Focus Session (tab flush), not a stack: unlisted, never indexed
    const fs = await getSharedSession(stackSlug);
    return { title: fs ? `${fs.title}` : 'Session not found', robots: { index: false, follow: false }, referrer: 'no-referrer' };
  }
  const s = await getPublicStack(stackSlug);
  if (!s) return { title: 'Stack not found', robots: { index: false, follow: false } };
  const n = s.items.length;
  const description = s.description || `${n} hand-picked link${n === 1 ? '' : 's'} curated by @${s.handle}. Fork this stack into your own Bukmarkz in one click.`;
  const title = s.remixed_from ? `${s.title} — remixed by @${s.handle}` : `${s.title} — curated by @${s.handle}`;
  return {
    metadataBase: new URL(SITE),
    title, description,
    alternates: { canonical: `/s/${s.slug}` },
    // Thin pages are the spam vector for any public-UGC feature: only index stacks with real content.
    robots: n >= 3 ? { index: true, follow: true } : { index: false, follow: true },
    // og:image / twitter:image come from ./opengraph-image.tsx automatically.
    openGraph: { type: 'website', siteName: 'Bukmarkz', title, description, url: `/s/${s.slug}` },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function StackPage({ params }: Props) {
  const { stackSlug } = await params;
  if (SESSION_ID_RE.test(stackSlug)) { const fs = await getSharedSession(stackSlug); if (!fs) notFound(); return <SharedSession s={fs} />; }
  const s = await getPublicStack(stackSlug);
  if (!s) notFound();

  const t = themeOf(s.theme);
  const url = `${SITE}/s/${s.slug}`;
  const fork = `/s/${s.slug}/fork`;
  const n = s.items.length;
  const share = {
    x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(`${s.title} — a curated stack by @${s.handle} on Bukmarkz`)}&url=${encodeURIComponent(url)}`,
    li: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
  };
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: s.title, description: s.description ?? undefined, url,
    dateModified: s.updated_at || undefined, author: { '@type': 'Person', name: `@${s.handle}` },
    ...(s.remixed_from ? { isBasedOn: `${SITE}/s/${s.remixed_from.slug}` } : {}),
    mainEntity: { '@type': 'ItemList', numberOfItems: n, itemListElement: s.items.map((i, k) => ({ '@type': 'ListItem', position: k + 1, url: i.url, name: i.title })) },
  };

  return (
    <div className="min-h-screen bg-[#f1f9f4] text-[#26372e]">
      {/* JSON-LD: '<' escaped so a title can never close the script tag */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />

      {/* 1. Viral CTA banner — the first thing every visitor sees */}
      <div className="bg-gradient-to-r from-[#1a7f4e] to-[#2fa66a] text-white">
        <div className="mx-auto flex max-w-3xl flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-snug sm:text-[15px]">
            <strong className="font-semibold">Like this stack?</strong> <span className="opacity-90">Add all {n} link{n === 1 ? '' : 's'} to your own Bukmarkz in one click.</span>
          </p>
          <Link href={fork} className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-[#0f6b3e] shadow-sm transition hover:bg-[#e6f4ec] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
            <span aria-hidden>⑂</span> Save these links to Bukmarkz
          </Link>
        </div>
      </div>

      {/* 2. Cover */}
      <header style={{ backgroundImage: `linear-gradient(135deg, ${t.from}, ${t.to})`, color: t.ink }}>
        <div className="mx-auto max-w-3xl px-4 pb-10 pt-10 sm:pb-14 sm:pt-14">
          <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: t.accent }}>Curated stack · {n} link{n === 1 ? '' : 's'}</p>
          <h1 className="mt-3 text-balance text-3xl font-bold leading-tight sm:text-5xl">{s.title}</h1>
          {s.description && <p className="mt-4 max-w-2xl text-pretty text-base leading-relaxed sm:text-lg" style={{ color: t.muted }}>{s.description}</p>}
          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" style={{ color: t.muted }}>
            <span className="inline-flex items-center gap-2">
              {s.avatar
                // eslint-disable-next-line @next/next/no-img-element -- pinned to our own Storage origin by safeAvatar()
                ? <img src={s.avatar} alt="" width={28} height={28} referrerPolicy="no-referrer" className="h-7 w-7 rounded-full object-cover" />
                : <span aria-hidden className="grid h-7 w-7 place-items-center rounded-full text-xs font-bold" style={{ background: t.chip, color: t.accent }}>{s.handle[0]?.toUpperCase()}</span>}
              <span>by <strong style={{ color: t.ink }}>@{s.handle}</strong></span>
            </span>
            {s.created_at && <time dateTime={s.created_at}>{new Date(s.created_at).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' })}</time>}
            {s.fork_count > 0 && <span>{s.fork_count.toLocaleString('en')} fork{s.fork_count === 1 ? '' : 's'}</span>}
          </div>
          {s.remixed_from && (
            <p className="mt-3 text-sm" style={{ color: t.muted }}>
              <span aria-hidden>⑂</span> Remixed from{' '}
              <Link href={`/s/${s.remixed_from.slug}`} className="font-semibold underline decoration-1 underline-offset-2" style={{ color: t.ink }}>@{s.remixed_from.handle}</Link>
              {s.remixed_from.title && <> · “{s.remixed_from.title}”</>}
            </p>
          )}
          <StackActions slug={s.slug} followerCount={s.follower_count} remixCount={s.remix_count} accent={t.accent} chip={t.chip} ink={t.ink} />
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            <a href={share.x} target="_blank" rel="noopener noreferrer" className="rounded-lg px-3 py-1.5 font-medium transition hover:opacity-80" style={{ background: t.chip, color: t.accent }}>Share on X</a>
            <a href={share.li} target="_blank" rel="noopener noreferrer" className="rounded-lg px-3 py-1.5 font-medium transition hover:opacity-80" style={{ background: t.chip, color: t.accent }}>Share on LinkedIn</a>
          </div>
        </div>
      </header>

      {/* 3. The list */}
      <main className="mx-auto max-w-3xl px-4 py-8 sm:py-10">
        {n === 0 ? <p className="rounded-2xl bg-white p-6 text-center text-[#4b5c53]">This stack has no links yet.</p> : (
          <ol className="space-y-3">
            {s.items.map((i, k) => (
              <li key={`${k}-${i.url}`}>
                {/* nofollow + ugc: these are user-supplied outbound links. */}
                <a href={i.url} target="_blank" rel="noopener noreferrer nofollow ugc"
                  className="group flex gap-4 rounded-2xl border border-[#d8eedf] bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-[#4fbf85] hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2fa66a] sm:p-5">
                  <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-bold" style={{ background: t.chip, color: t.accent }}>{k + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[17px] font-semibold leading-snug text-[#10261c] [overflow-wrap:anywhere] group-hover:text-[#1a7f4e]">{i.title}</span>
                    <span className="mt-0.5 block truncate text-sm text-[#5b6d63]">{host(i.url)} ↗</span>
                    {i.blurb && <span className="mt-2 block text-[15px] leading-relaxed text-[#33443b]">{i.blurb}</span>}
                  </span>
                </a>
              </li>
            ))}
          </ol>
        )}

        {/* 4. Second CTA at the point of maximum intent: the end of the list */}
        <section aria-labelledby="fork-h" className="mt-10 rounded-3xl bg-gradient-to-br from-[#1a7f4e] to-[#2fa66a] p-6 text-center text-white shadow-lg sm:p-9">
          <h2 id="fork-h" className="text-balance text-2xl font-bold sm:text-3xl">Keep these. Make them yours.</h2>
          <p className="mx-auto mt-2 max-w-md text-pretty text-white/90">Fork this stack into Bukmarkz to search, organise and get AI summaries of every link. Free to start.</p>
          <Link href={fork} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 font-semibold text-[#0f6b3e] transition hover:bg-[#e6f4ec] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
            <span aria-hidden>⑂</span> Save these links to Bukmarkz
          </Link>
        </section>

        <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-[#d8eedf] pt-6 text-sm text-[#5b6d63]">
          <span>Made with <Link href="/" className="font-semibold text-[#1a7f4e] hover:underline">Bukmarkz</Link> · <Link href="/login" className="hover:underline">Create your own stack</Link></span>
          <a href={`mailto:abuse@bukmarkz.com?subject=${encodeURIComponent(`Report stack: ${s.slug}`)}`} className="hover:underline" rel="nofollow">Report this stack</a>
        </footer>
      </main>
    </div>
  );
}
