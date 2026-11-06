import type { Metadata } from 'next';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import SwitchDropzone from '@/components/switch/SwitchDropzone';

// Static, indexable landing pages: one per source tool. Unknown tools are a real 404 (not a silent fallback to Raindrop).
export const dynamicParams = false;
export const revalidate = 86400;

interface Tool { name: string; h1: string; blurb: string; steps: string[]; help?: { label: string; href: string }; notice?: { text: string; label: string; href: string } }
const TOOLS: Record<string, Tool> = {
  raindrop: {
    name: 'Raindrop.io', h1: 'Move your Raindrop.io bookmarks to Bukmarkz', blurb: 'Keep your collections and tags, then search everything by meaning.',
    steps: ['In Raindrop (web or desktop app), open the collection you want, or All bookmarks.', 'Click Export and choose HTML or CSV.', 'Drop the downloaded file below.'],
    help: { label: 'Raindrop’s export guide', href: 'https://help.raindrop.io/export' },
  },
  pocket: {
    name: 'Pocket', h1: 'Import your saved Pocket export into Bukmarkz', blurb: 'For people who downloaded their Pocket data before it closed.',
    steps: ['Find the export file you saved from Pocket (an HTML or CSV file).', 'Drop it below. Tags and save dates are kept when the file includes them.'],
    notice: { text: 'Pocket shut down in 2025 and its export window closed on November 12, 2025, after which user data was queued for deletion. Only a file you already saved can be imported.', label: 'Mozilla’s notice', href: 'https://support.mozilla.org/kb/future-of-pocket' },
  },
  browser: {
    name: 'your browser', h1: 'Import your browser bookmarks into Bukmarkz', blurb: 'Chrome, Edge, Firefox and Safari all export the same file type.',
    steps: ['Chrome or Edge: open the bookmark manager (Ctrl/Cmd+Shift+O), open the ⋮ menu and choose Export bookmarks.', 'Firefox: Library (Ctrl/Cmd+Shift+O), Import and Backup, Export Bookmarks to HTML. Safari: File, Export, Bookmarks.', 'Drop the HTML file below.'],
  },
};
export function generateStaticParams() { return Object.keys(TOOLS).map((tool) => ({ tool })); }

export async function generateMetadata({ params }: { params: Promise<{ tool: string }> }): Promise<Metadata> {
  const t = TOOLS[(await params).tool];
  if (!t) return {};
  const title = `${t.h1} in 60 seconds`;
  return { title: `${title}`, description: `${t.blurb} Your file is read in your browser; nothing is uploaded until you sign in.`, alternates: { canonical: `/switch/${(await params).tool}` }, openGraph: { title, type: 'website' } };
}

export default async function SwitchPage({ params }: { params: Promise<{ tool: string }> }) {
  const key = (await params).tool;
  const t = TOOLS[key];
  if (!t) return null;                                              // unreachable with dynamicParams = false
  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-slate-950 px-4 py-12 text-slate-100">
      <header className="mb-10 space-y-3 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400"><Sparkles className="h-3.5 w-3.5" aria-hidden />Switch in about a minute</span>
        <h1 className="text-balance text-3xl font-bold tracking-tight text-white sm:text-5xl">{t.h1}</h1>
        <p className="mx-auto max-w-xl text-sm text-slate-400 sm:text-base">{t.blurb}</p>
      </header>

      {t.notice && <p className="mb-6 rounded-xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">{t.notice.text} <a className="underline" href={t.notice.href} target="_blank" rel="noopener noreferrer">{t.notice.label}</a>.</p>}

      <section className="mb-8 rounded-2xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-md" aria-labelledby="how">
        <h2 id="how" className="mb-3 text-sm font-semibold text-slate-200">How to get your file</h2>
        <ol className="list-inside list-decimal space-y-2 text-sm text-slate-400">{t.steps.map((s) => <li key={s}>{s}</li>)}</ol>
        {t.help && <p className="mt-3 text-xs text-slate-500">Menu names change now and then. See <a className="underline hover:text-slate-300" href={t.help.href} target="_blank" rel="noopener noreferrer">{t.help.label}</a> if you can’t find it.</p>}
      </section>

      <SwitchDropzone tool={key} toolName={t.name} />

      <nav aria-label="Other sources" className="mt-10 flex flex-wrap justify-center gap-4 text-xs text-slate-500">
        {Object.entries(TOOLS).filter(([k]) => k !== key).map(([k, o]) => <Link key={k} href={`/switch/${k}`} className="hover:text-emerald-400">Import from {o.name}</Link>)}
      </nav>
    </main>
  );
}
