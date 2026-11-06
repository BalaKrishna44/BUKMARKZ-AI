import Link from 'next/link';
import type { SharedSessionData } from '@/lib/sessions/public';

const shown = (u: string) => { try { const x = new URL(u); return x.hostname.replace(/^www\./, '') + (x.pathname === '/' ? '' : x.pathname); } catch { return u; } };

/** The public "Focus Session" page behind bukmarkz.com/s/<session_id>. Server component; no cookies, so the route stays cacheable. */
export default function SharedSession({ s }: { s: SharedSessionData }) {
  const when = s.created_at ? new Date(s.created_at).toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
  return (
    <div className="min-h-screen bg-[#05070d] text-slate-100">
      <main className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-xs font-medium uppercase tracking-wide text-[#fca311]">Focus session{when ? ` · ${when}` : ''}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{s.title}</h1>
        {s.summary && <p className="mt-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-sm leading-relaxed text-slate-300"><span className="mr-1 text-[#fca311]" aria-hidden>✦</span>{s.summary}</p>}
        <p className="mt-4 text-sm text-slate-400">{s.tab_count} tab{s.tab_count === 1 ? '' : 's'} saved from one browser window.</p>
        <ol className="mt-3 space-y-1.5">
          {s.tabs.map((t, i) => (
            <li key={i} className="flex items-center gap-3 rounded-lg bg-slate-900 p-2.5">
              {t.favicon
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={t.favicon} alt="" width={16} height={16} loading="lazy" referrerPolicy="no-referrer" className="h-4 w-4 shrink-0 rounded-sm" />
                : <span className="h-4 w-4 shrink-0 rounded-sm bg-slate-700" aria-hidden />}
              <div className="min-w-0">
                <a href={t.url} target="_blank" rel="noopener noreferrer nofollow ugc" className="block truncate text-sm font-medium hover:text-[#fca311]">{t.title}</a>
                <span className="block truncate text-xs text-slate-500">{shown(t.url)}</span>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-8 rounded-xl border border-slate-800 p-4 text-sm text-slate-300">
          Too many tabs yourself? <Link href="/" className="font-semibold text-[#fca311] underline">Bukmarkz</Link> saves a whole window in one click and closes the clutter.
        </div>
        <p className="mt-4 text-[11px] text-slate-500">Links were chosen by the person who shared this page. Bukmarkz has not reviewed them.</p>
      </main>
    </div>
  );
}
