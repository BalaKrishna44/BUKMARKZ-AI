import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Download } from 'lucide-react';
import { Buk, Markz } from '@/components/brand/Mascots';
import FeatureGrid from '@/components/landing/FeatureGrid';
import HeroSearchMockup from '@/components/landing/HeroSearchMockup';
import LiveSandbox from '@/components/landing/LiveSandbox';
import { btnGhost, btnPrimary, focusRing } from '@/lib/ui';

// Server component: static HTML + metadata; only the three interactive pieces ship JavaScript.
export const metadata: Metadata = {
  title: { absolute: 'Bukmarkz: the vault that remembers your links and answers questions about them' },
  description: 'Save links once, then ask questions about them in plain words. Bukmarkz finds the answer in your own vault and shows its sources.',
  alternates: { canonical: '/' },
};

const NAV = [['Features', '#features'], ['Try it', '#sandbox'], ['Switch', '/switch/raindrop']] as const;

export default function LandingPage() {
  return (
    <div className="relative isolate overflow-x-clip">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[40rem] bg-[radial-gradient(60rem_28rem_at_50%_-10%,rgba(16,185,129,.16),transparent)]" />

      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/" className={`flex items-center gap-2 text-lg font-bold tracking-tight text-white ${focusRing}`}><Buk className="h-8 w-8" />Bukmarkz</Link>
        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
          {NAV.map(([label, href]) => <a key={label} href={href} className={`hidden rounded-lg px-3 py-2 text-sm text-slate-300 hover:text-white sm:block ${focusRing}`}>{label}</a>)}
          <Link href="/login" className={`rounded-lg px-3 py-2 text-sm text-slate-300 hover:text-white ${focusRing}`}>Sign in</Link>
          <Link href="/login?next=%2Fdashboard" className={`rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 ${focusRing}`}>Start free</Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-8 sm:px-6 lg:grid-cols-2 lg:gap-14 lg:pb-24 lg:pt-14">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">AI-native bookmarks</p>
            <h1 className="text-balance text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl">The vault that remembers your links and <span className="text-emerald-400">answers questions about them</span></h1>
            <p className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-slate-400 sm:text-lg">Save a page once. Months later, ask what it said, and get an answer from your own links with the sources next to it.</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/login?next=%2Fdashboard" className={btnPrimary}>Start free <ArrowRight className="h-4 w-4" aria-hidden /></Link>
              <Link href="/switch/raindrop" className={btnGhost}><Download className="h-4 w-4" aria-hidden />Switch from Raindrop</Link>
            </div>
            <div className="mt-10 flex items-end gap-3">
              <Buk className="h-16 w-16 shrink-0" title="Buk, the scholar owl" />
              <div className="rounded-2xl rounded-bl-sm border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm text-slate-300"><b className="text-white">I’m Buk.</b> I read what you save and answer from it.</div>
              <Markz className="h-12 w-12 shrink-0" title="Markz, the sidekick" />
              <div className="hidden rounded-2xl rounded-bl-sm border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm text-slate-300 sm:block"><b className="text-white">I’m Markz.</b> I bring old links back when they matter.</div>
            </div>
          </div>
          <HeroSearchMockup />
        </section>

        <section id="features" aria-labelledby="f-h" className="mx-auto max-w-6xl scroll-mt-8 px-4 py-16 sm:px-6">
          <h2 id="f-h" className="text-balance text-2xl font-bold tracking-tight text-white sm:text-3xl">Everything you saved, working for you</h2>
          <p className="mb-8 mt-2 max-w-2xl text-slate-400">Saving is the easy part. These are the parts that bring it back.</p>
          <FeatureGrid />
        </section>

        <section id="sandbox" aria-labelledby="s-h" className="mx-auto max-w-5xl scroll-mt-8 px-4 py-16 sm:px-6">
          <h2 id="s-h" className="text-balance text-2xl font-bold tracking-tight text-white sm:text-3xl">Try it now. No account.</h2>
          <p className="mb-6 mt-2 max-w-2xl text-slate-400">Ask a question about a small demo vault and see how an answer with sources looks.</p>
          <LiveSandbox />
        </section>

        <section className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6">
          <div className="mx-auto mb-4 flex w-fit items-end"><Buk className="h-16 w-16" /><Markz className="-ml-2 h-11 w-11" /></div>
          <h2 className="text-balance text-3xl font-bold tracking-tight text-white sm:text-4xl">Stop losing the good stuff</h2>
          <p className="mx-auto mt-3 max-w-xl text-slate-400">Bring your existing bookmarks or start fresh. Either takes about a minute.</p>
          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row"><Link href="/login?next=%2Fdashboard" className={btnPrimary}>Start free</Link><Link href="/switch/raindrop" className={btnGhost}>Import a bookmarks file</Link></div>
        </section>
      </main>

      <footer className="border-t border-slate-800/80 px-4 py-8 text-center text-xs text-slate-500">© Bukmarkz</footer>
    </div>
  );
}
