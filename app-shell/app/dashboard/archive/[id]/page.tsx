import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AutoRefresh, MarkdownReader, ReadingProgress, RetryButton } from './Reader';

export const dynamic = 'force-dynamic';           // per-user content: never cache across users

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLS = 'id,url,title,archive_status,archive_error,archive_title,archive_byline,archive_site,archive_lang,archive_words,archive_minutes,archive_truncated,archived_at,full_markdown_content';

interface Row {
  id: string; url: string; title: string | null; archive_status: 'none' | 'pending' | 'processing' | 'done' | 'failed'; archive_error: string | null;
  archive_title: string | null; archive_byline: string | null; archive_site: string | null; archive_lang: string | null;
  archive_words: number | null; archive_minutes: number | null; archive_truncated: boolean; archived_at: string | null; full_markdown_content: string | null;
}

const ERRORS: Record<string, string> = {
  blocked_address: 'This address can’t be archived for security reasons.', bad_url: 'This doesn’t look like a web page address.',
  timeout: 'The site took too long to respond.', network: 'We couldn’t reach the site.', http_error: 'The site refused or couldn’t find the page.',
  not_html: 'This link isn’t a web page (it may be a file or video).', too_large: 'The page is too large to archive.',
  no_readable_content: 'No readable article was found. The page may need a login or only render with JavaScript.',
};

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const safeHref = (u: string) => (/^https?:\/\//i.test(u) ? u : '#');

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!UUID.test(id)) return { title: 'Archive' };
  const supabase = await createClient();
  const { data } = await supabase.from('oneclist_items').select('archive_title,title').eq('id', id).maybeSingle();     // RLS limits this to the owner
  return { title: `${data?.archive_title || data?.title || 'Archive'} · Bukmarkz`, robots: { index: false, follow: false } };
}

export default async function ArchivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/dashboard/archive/${id}`);

  const { data: row, error } = await supabase.from('oneclist_items').select(COLS).eq('id', id).eq('user_id', user.id).maybeSingle<Row>();
  if (error) console.error('archive load failed', error.message);          // never log content
  if (!row) notFound();                                                    // same response for "missing" and "someone else's"

  const title = row.archive_title || row.title || hostOf(row.url);
  const waiting = row.archive_status === 'pending' || row.archive_status === 'processing';

  return (
    <div className="min-h-screen bg-[#f1f9f4] text-[#33443b]">
      {row.archive_status === 'done' && <ReadingProgress />}
      <header className="sticky top-0 z-10 border-b border-[#d8eedf] bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/dashboard" className="rounded-lg px-2 py-1 text-sm font-medium text-[#1a7f4e] hover:bg-[#e6f4ec] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2fa66a]">← Dashboard</Link>
          <a href={safeHref(row.url)} target="_blank" rel="noopener noreferrer" className="truncate rounded-lg px-2 py-1 text-sm text-[#4b5c53] hover:bg-[#e6f4ec]">
            View original · {hostOf(row.url)} ↗
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        {row.archive_status === 'done' && row.full_markdown_content ? (
          <article lang={row.archive_lang || undefined}>
            <div className="mb-8 border-b border-[#d8eedf] pb-6">
              <p className="text-xs font-medium uppercase tracking-wider text-[#1a7f4e]">{row.archive_site || hostOf(row.url)}</p>
              <h1 className="mt-2 text-balance text-3xl font-bold leading-tight text-[#10261c] sm:text-4xl">{title}</h1>
              <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[#4b5c53]">
                {row.archive_byline && <span>{row.archive_byline}</span>}
                <span className="rounded-full bg-[#e6f4ec] px-2.5 py-0.5 font-medium text-[#0f6b3e]">{row.archive_minutes ?? 1} min read</span>
                {row.archive_words ? <span>{row.archive_words.toLocaleString('en')} words</span> : null}
                {row.archived_at && <time dateTime={row.archived_at}>Saved {new Date(row.archived_at).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' })}</time>}
              </p>
              {row.archive_truncated && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">This page was very long, so the archive stops partway. Open the original for the rest.</p>}
            </div>
            <MarkdownReader markdown={stripLeadingTitle(row.full_markdown_content, row.archive_title)} />
          </article>
        ) : waiting ? (
          <Notice title="Archiving this page…" body="This usually takes a few seconds. The page will appear here on its own."><AutoRefresh /></Notice>
        ) : row.archive_status === 'failed' ? (
          <Notice title="We couldn’t archive this page" body={ERRORS[row.archive_error ?? ''] ?? 'Something went wrong while saving it.'} action={<RetryButton id={row.id} />} />
        ) : (
          <Notice title="Not archived yet" body="Save an offline, searchable copy of this page." action={<RetryButton id={row.id} label="Archive this page" />} />
        )}
      </main>
    </div>
  );
}

/** The worker prepends "# Title"; the page header already shows it. */
function stripLeadingTitle(md: string, title: string | null) {
  const m = /^# (.+)\n+/.exec(md);
  return m && (!title || m[1].trim() === title.trim()) ? md.slice(m[0].length) : md;
}

function Notice({ title, body, action, children }: { title: string; body: string; action?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div role="status" className="mx-auto mt-16 max-w-md rounded-2xl border border-[#d8eedf] bg-white p-6 text-center shadow-sm">
      <h1 className="text-lg font-semibold text-[#10261c]">{title}</h1>
      <p className="mt-2 text-sm text-[#4b5c53]">{body}</p>
      {action && <div className="mt-4">{action}</div>}
      {children}
    </div>
  );
}

