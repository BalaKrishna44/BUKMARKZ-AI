import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { getPublicStack, SITE } from '@/lib/stacks/public';
import { validSlug } from '@/lib/stacks/slug';
import { DuplicateButton } from './DuplicateButton';

/**
 * Public Vault Portfolio: bukmarkz.com/<handle>/<slug>
 *
 * - Reads ONLY through the anonymous get_public_stack() RPC (no cookies), so the page is statically cached (ISR) and a viral link costs
 *   almost nothing. Private, blocked, unknown and mismatched URLs are all the same 404.
 * - Slugs are globally unique, so the handle in the URL is a vanity prefix that must match the stack's real owner. A wrong handle
 *   301-redirects to the right URL (old shared links keep working if a handle ever changes) instead of serving the page under a
 *   name that does not own it. That also stops "bukmarkz.com/<someone-else>/<their-stack>" impersonation links.
 * - Reserved words (login, dashboard, ...) are rejected so this route can never shadow a real page. Static routes already win in Next.
 */
export const revalidate = 300;
type Params = { username: string; slug: string };
const HANDLE = /^[a-z0-9_]{3,20}$/;
const RESERVED = new Set(['admin', 'api', 'app', 'auth', 'dashboard', 'login', 'logout', 'register', 'settings', 'signup', 's', 'stacks', 'support', 'www']);

const load = async ({ username, slug }: Params) => {
  const handle = username.toLowerCase(), s = slug.toLowerCase();
  if (!HANDLE.test(handle) || RESERVED.has(handle) || !validSlug(s)) return null;
  const stack = await getPublicStack(s);
  return stack ? { stack, requested: handle } : null;
};

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const r = await load(await params);
  if (!r) return { title: 'Stack not found · Bukmarkz', robots: { index: false } };
  const { stack: s } = r, url = `${SITE}/${s.handle}/${s.slug}`;
  const description = s.description || `${s.items.length} hand-picked links curated by @${s.handle}. Duplicate them into your own Bukmarkz vault.`;
  return {
    title: `${s.title} by @${s.handle} · Bukmarkz`, description, alternates: { canonical: url },
    openGraph: { title: s.title, description, url, type: 'website', siteName: 'Bukmarkz' }, twitter: { card: 'summary_large_image', title: s.title, description },
  };
}

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

export default async function PortfolioPage({ params }: { params: Promise<Params> }) {
  const r = await load(await params);
  if (!r) notFound();
  const { stack: s, requested } = r;
  if (requested !== s.handle) permanentRedirect(`/${s.handle}/${s.slug}`);   // wrong/old handle -> the real URL

  const n = s.items.length;
  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* ambient glow behind the glass */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-24 top-[-6rem] h-96 w-96 rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="absolute right-[-6rem] top-48 h-[28rem] w-[28rem] rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="absolute bottom-[-8rem] left-1/3 h-96 w-96 rounded-full bg-violet-500/10 blur-3xl" />
      </div>

      <div className="mx-auto max-w-3xl px-4 pb-20 pt-10 sm:px-6 sm:pt-16">
        <header className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 shadow-2xl shadow-black/30 backdrop-blur-md sm:p-9">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-300">Vault portfolio · @{s.handle}</p>
          <h1 className="mt-3 text-balance text-3xl font-bold tracking-tight sm:text-4xl">{s.title}</h1>
          {s.description && <p className="mt-3 max-w-prose text-pretty text-slate-300">{s.description}</p>}
          <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-400">
            <span>{n} link{n === 1 ? '' : 's'}</span>
            {s.fork_count > 0 && <><span aria-hidden>·</span><span>{s.fork_count.toLocaleString('en')} duplicate{s.fork_count === 1 ? '' : 's'}</span></>}
            {s.updated_at && <><span aria-hidden>·</span><span>updated <time dateTime={s.updated_at}>{new Date(s.updated_at).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' })}</time></span></>}
          </p>
          <div className="mt-6"><DuplicateButton slug={s.slug} count={n} /></div>
          <p className="mt-3 text-xs text-slate-500">Adds these links to your own private vault, tagged <code className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">stack-{s.slug}</code>. Links you already have are skipped.</p>
        </header>

        <ol className="mt-6 grid gap-3">
          {s.items.map((it, i) => (
            <li key={`${i}-${it.url}`}>
              {/* nofollow + ugc: user-supplied outbound links. target=_blank needs noopener (also implied by modern browsers). */}
              <a href={it.url} target="_blank" rel="nofollow ugc noopener noreferrer"
                className="group flex gap-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 backdrop-blur-md transition hover:-translate-y-0.5 hover:border-emerald-400/40 hover:bg-slate-900/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300">
                <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-700 bg-slate-800/80 text-sm font-bold uppercase text-emerald-300">{(hostOf(it.url)[0] ?? '#')}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-slate-100 group-hover:text-emerald-200">{it.title}</span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">{hostOf(it.url)}</span>
                  {it.blurb && <span className="mt-2 block text-pretty text-sm leading-relaxed text-slate-300">{it.blurb}</span>}
                </span>
                <svg aria-hidden viewBox="0 0 24 24" className="mt-1 h-4 w-4 shrink-0 text-slate-500 transition group-hover:text-emerald-300" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M8 7h9v9" /></svg>
              </a>
            </li>
          ))}
        </ol>

        <section className="mt-10 rounded-3xl border border-slate-800 bg-slate-900/60 p-6 text-center backdrop-blur-md">
          <h2 className="text-balance text-xl font-bold">Keep these. Make them yours.</h2>
          <p className="mx-auto mt-2 max-w-md text-pretty text-sm text-slate-300">Duplicate this stack to search it, organise it and get AI summaries of every link. Free to start.</p>
          <div className="mt-4 flex justify-center"><DuplicateButton slug={s.slug} count={n} /></div>
        </section>
        <p className="mt-8 text-center text-xs text-slate-500">Curated by @{s.handle} on Bukmarkz. Links are chosen by the curator; Bukmarkz does not endorse them.</p>
      </div>
    </main>
  );
}
