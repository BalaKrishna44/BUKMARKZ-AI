import type { Metadata } from 'next';
import type { ComponentType, ReactNode } from 'react';
import { ArrowRight, Bell, Check, ChevronRight, Download, FolderInput, Minus, Search, ShieldCheck, Sparkles, Upload, X } from 'lucide-react';
import { JsonLd } from '@/components/JsonLd';
import { PRICE, SITE_NAME, SITE_URL, TRIAL_MONTHS } from '@/lib/site-data';

/* This is a server component on purpose: all of the copy is in the first HTML response, which is what search engines read. */

const PATH = '/vs/raindrop';
const CHECKED_ON = '20 October 2026';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'Raindrop.io Alternative: Bukmarkz vs Raindrop.io',
  description: `Comparing Bukmarkz and Raindrop.io side by side: reminders, search, notes, apps and import. See where each is stronger, then try Bukmarkz free for ${TRIAL_MONTHS} months.`,
  alternates: { canonical: PATH },
  openGraph: {
    title: 'Raindrop.io alternative: Bukmarkz vs Raindrop.io',
    description: `An honest side-by-side comparison, and how to bring your Raindrop bookmarks with you. ${TRIAL_MONTHS} months of Pro free.`,
    url: PATH,
    siteName: SITE_NAME,
    images: [{ url: '/assets/social/og-image.png', width: 1200, height: 630, alt: 'Bukmarkz AI' }],
    type: 'article',
  },
  twitter: { card: 'summary_large_image', title: 'Raindrop.io alternative: Bukmarkz vs Raindrop.io', images: ['/assets/social/twitter-card.png'] },
};

type Icon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;

const LINKS = {
  signIn: '/login',
  claim: '/signup?plan=pro-trial&source=raindrop',
  home: '/',
  pricing: '/#pricing',
};

/* ------------------------------------------------------------------------------------------
   Comparison data. Raindrop.io facts come from raindrop.io and help.raindrop.io, read on
   ${CHECKED_ON}. Anything those pages do not state is shown as "Not stated", never as "No".
   Bukmarkz status must match the product: change 'soon' to 'live' only when it ships.
   ------------------------------------------------------------------------------------------ */

type Mark = 'yes' | 'partial' | 'no' | 'unknown';
interface Side { mark: Mark; text: string }
const side = (mark: Mark, text: string): Side => ({ mark, text });

const ROWS: Array<{ feature: string; bukmarkz: Side; raindrop: Side }> = [
  { feature: 'AI action checklists', bukmarkz: side('no', 'Coming soon'), raindrop: side('unknown', 'Not stated. Has an AI Assistant and AI suggestions (Pro)') },
  { feature: 'Search by meaning (vector search)', bukmarkz: side('partial', 'Beta. Searches titles, notes and descriptions'), raindrop: side('partial', 'Full-text search of pages, PDFs and YouTube (Pro)') },
  { feature: 'Reminders', bukmarkz: side('partial', 'Beta. This evening, tomorrow, in 3 days, next Monday'), raindrop: side('yes', 'Reminders and notifications (Pro)') },
  { feature: 'Notes on every save', bukmarkz: side('partial', 'Beta. Quick Markdown notes when you save'), raindrop: side('partial', 'Highlights and annotations (Pro)') },
  { feature: 'Private saves that stay on your device', bukmarkz: side('yes', 'Chrome private windows, extension'), raindrop: side('unknown', 'Not stated') },
  { feature: 'Mobile apps and share sheet', bukmarkz: side('no', 'Coming soon'), raindrop: side('yes', 'iOS and Android apps') },
  { feature: 'WhatsApp or Telegram saving', bukmarkz: side('no', 'Coming soon'), raindrop: side('unknown', 'Not stated') },
  { feature: 'OCR text from images', bukmarkz: side('no', 'Not available'), raindrop: side('unknown', 'Not stated') },
];

const WHY: Array<{ icon: Icon; title: string; text: string }> = [
  { icon: Bell, title: 'Saves that come back', text: 'Set a reminder when you save: this evening, tomorrow, in 3 days or next Monday. A notification opens the page, so a link turns into something you finish.' },
  { icon: Search, title: 'Find it by describing it', text: '"That piece about cheap vegetarian dinners" can find the lentil article even if it never uses the word "cheap". Search by meaning is in beta.' },
  { icon: ShieldCheck, title: 'Private saves stay private', text: 'Pages you save in a Chrome private window stay on your device. They are never uploaded to your account or sent to AI.' },
];

const STEPS: Array<{ icon: Icon; title: string; text: string }> = [
  { icon: Download, title: 'Export from Raindrop', text: 'In Raindrop, open Settings, then Backups, then Create new. Raindrop emails you when the files are ready. Download the HTML file. You can also export a single collection.' },
  { icon: Upload, title: 'Upload to Bukmarkz', text: 'Sign up, choose Import, and drop in the HTML file. Files can be up to 5 MB. If your library is larger, import one collection at a time.' },
  { icon: FolderInput, title: 'Check, then keep both', text: 'Your links, titles and folders appear in Bukmarkz. Nothing changes in Raindrop, so you can run both side by side until you are sure.' },
];

const FAQ: Array<{ q: string; a: string }> = [
  { q: 'Is Bukmarkz a good Raindrop.io alternative?', a: `It depends on what you need. Raindrop.io is more mature, with apps for iOS, Android, Windows and macOS and extensions for Chrome, Firefox, Safari and Edge. Bukmarkz is newer and is built around what you do next with a save: reminders, quick notes and search by meaning, with action checklists on the way. Because you can try Bukmarkz free for ${TRIAL_MONTHS} months and keep Raindrop while you do, you can compare them on your own bookmarks.` },
  { q: 'Can I import my Raindrop.io bookmarks into Bukmarkz?', a: 'Yes. Export your bookmarks from Raindrop as an HTML file, then upload it to Bukmarkz. Your links, titles and folders come across. Tags, highlights and uploaded files do not carry over yet, and import files can be up to 5 MB.' },
  { q: 'Will importing change or delete anything in Raindrop.io?', a: 'No. An export is a copy. Your Raindrop account stays exactly as it is until you decide to close it.' },
  { q: 'Does Bukmarkz have mobile apps?', a: 'Not yet. iOS and Android share sheets, and saving through WhatsApp or Telegram, are in development. Today you can save from the Chrome extension and the web app. If saving from your phone is essential to you, keep using Raindrop for now.' },
  { q: 'Do I need a credit card to try Bukmarkz?', a: `No. You can claim ${TRIAL_MONTHS} months of Pro free without entering a credit card.` },
];

/* ------------------------------------------------------------------------------------------ */

const amberBtn = 'inline-flex items-center justify-center gap-2 rounded-lg bg-[#fca311] px-5 py-3 text-base font-semibold text-[#14213d] shadow-[0_8px_30px_-10px_rgba(252,163,17,0.9)] transition-colors hover:bg-[#ffb23e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';
const ghostBtn = 'inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-5 py-3 text-base font-semibold text-slate-100 transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fca311]';

function MarkIcon({ mark }: { mark: Mark }) {
  if (mark === 'yes') return <><Check className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" /><span className="sr-only">Yes. </span></>;
  if (mark === 'partial') return <><Minus className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" /><span className="sr-only">Partly. </span></>;
  if (mark === 'no') return <><X className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" /><span className="sr-only">No. </span></>;
  return <><span className="grid h-4 w-4 shrink-0 place-items-center text-xs text-slate-500" aria-hidden="true">?</span><span className="sr-only">Not stated. </span></>;
}

function Section({ id, eyebrow, title, children, tint = false }: { id: string; eyebrow?: string; title: string; children: ReactNode; tint?: boolean }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`scroll-mt-16 px-4 py-16 sm:px-6 sm:py-20 ${tint ? 'border-y border-white/[0.06] bg-white/[0.015]' : ''}`}>
      <div className="mx-auto max-w-4xl">
        {eyebrow && <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#fca311]">{eyebrow}</p>}
        <h2 id={`${id}-title`} className="mt-2 text-balance text-3xl font-semibold tracking-tight text-white sm:text-4xl">{title}</h2>
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}

export default function VsRaindropPage() {
  const breadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name: 'Bukmarkz vs Raindrop.io', item: `${SITE_URL}${PATH}` },
    ],
  };
  const webpage = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${SITE_URL}${PATH}#webpage`,
    url: `${SITE_URL}${PATH}`,
    name: 'Raindrop.io alternative: Bukmarkz vs Raindrop.io',
    isPartOf: { '@id': `${SITE_URL}/#website` },
    inLanguage: 'en',
  };

  return (
    <div className="min-h-screen bg-[#05070d] text-slate-300 antialiased selection:bg-[#fca311]/30">
      <JsonLd id="vs-raindrop-breadcrumbs" data={breadcrumbs} />
      <JsonLd id="vs-raindrop-webpage" data={webpage} />

      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-[#fca311] focus:px-3 focus:py-2 focus:text-[#14213d]">Skip to content</a>

      <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#05070d]/80 backdrop-blur-xl">
        <nav aria-label="Main" className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <a href={LINKS.home} aria-label="Bukmarkz home" className="flex items-center gap-2 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#fca311]">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-[#ffd27a] via-[#fca311] to-[#e08600] text-sm font-bold text-[#14213d]" aria-hidden="true">B</span>
            <span className="text-[15px] font-semibold tracking-tight text-white">Bukmarkz <span className="text-[#fca311]">AI</span></span>
          </a>
          <div className="flex items-center gap-2">
            <a href={LINKS.pricing} className="hidden rounded-md px-3 py-1.5 text-sm text-slate-400 hover:text-white sm:block">Pricing</a>
            <a href={LINKS.signIn} className="rounded-md px-3 py-1.5 text-sm text-slate-300 hover:text-white">Sign In</a>
            <a href={LINKS.claim} className="inline-flex items-center rounded-lg bg-[#fca311] px-3.5 py-2 text-sm font-semibold text-[#14213d] hover:bg-[#ffb23e]">Claim {TRIAL_MONTHS} Months Free</a>
          </div>
        </nav>
      </header>

      <main id="main">
        {/* ------------------------------------------------------------- hero */}
        <section className="relative isolate overflow-hidden px-4 pb-16 pt-14 sm:px-6 sm:pb-20 sm:pt-20">
          <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-[-140px] -z-10 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-[#fca311]/[0.12] blur-3xl" />
          <div className="mx-auto max-w-4xl text-center">
            <nav aria-label="Breadcrumb" className="mb-6 flex justify-center">
              <ol className="flex items-center gap-1.5 text-xs text-slate-500">
                <li><a href={LINKS.home} className="hover:text-slate-300">Home</a></li>
                <li aria-hidden="true"><ChevronRight className="h-3 w-3" /></li>
                <li aria-current="page" className="text-slate-300">Bukmarkz vs Raindrop.io</li>
              </ol>
            </nav>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#fca311]">Raindrop.io alternative</p>
            <h1 className="mt-3 text-balance text-4xl font-semibold leading-[1.08] tracking-tight text-white sm:text-6xl">
              The AI-native Raindrop alternative built for <span className="bg-gradient-to-r from-[#ffd27a] to-[#fca311] bg-clip-text text-transparent">action</span>
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg text-slate-400">
              You already save the good stuff. Bukmarkz helps you do something with it: set a reminder, add a note while it is fresh, and find it later by describing it. Bring your Raindrop.io bookmarks with you and try it free for {TRIAL_MONTHS} months.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a href={LINKS.claim} className={`${amberBtn} w-full sm:w-auto`}>Claim {TRIAL_MONTHS} Months Free Pro <ArrowRight className="h-4 w-4" aria-hidden="true" /></a>
              <a href="#comparison" className={`${ghostBtn} w-full sm:w-auto`}>See the comparison</a>
            </div>
            <ul className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-slate-400">
              {['No credit card required', 'Import from a Raindrop HTML export', 'Keep Raindrop while you try it'].map((t) => (
                <li key={t} className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-[#fca311]" aria-hidden="true" />{t}</li>
              ))}
            </ul>
          </div>
        </section>

        {/* -------------------------------------------------- quick answer */}
        <section aria-labelledby="quick-answer" className="px-4 pb-4 sm:px-6">
          <div className="mx-auto max-w-4xl rounded-2xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">
            <h2 id="quick-answer" className="text-xl font-semibold text-white">Bukmarkz vs Raindrop.io in one minute</h2>
            <p className="mt-3 text-slate-300">
              <strong className="font-semibold text-white">Raindrop.io</strong> is a mature bookmark manager with apps on every major platform, full-text search of the pages you save and web archiving. <strong className="font-semibold text-white">Bukmarkz</strong> is newer and focused on what happens after you save: reminders and quick notes today, search by meaning in beta, and AI action checklists coming soon. If you need a phone app today, Raindrop is the safer choice. If you want your saves to turn into things you do, Bukmarkz is worth a free trial.
            </p>
          </div>
        </section>

        {/* ------------------------------------------------------ matrix */}
        <Section id="comparison" eyebrow="Side by side" title="Bukmarkz vs Raindrop.io: feature comparison">
          <div className="relative overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[620px] border-collapse text-sm">
              <caption className="sr-only">Feature comparison of Bukmarkz and Raindrop.io</caption>
              <thead>
                <tr className="bg-white/[0.03]">
                  <th scope="col" className="sticky left-0 z-10 bg-[#0b0f1c] px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Feature</th>
                  <th scope="col" className="border-x border-[#fca311]/30 bg-[#fca311]/[0.07] px-4 py-3 text-left text-sm font-semibold text-[#ffcf70]">Bukmarkz</th>
                  <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-slate-300">Raindrop.io</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.feature} className="border-t border-white/[0.06] align-top">
                    <th scope="row" className="sticky left-0 z-10 bg-[#0b0f1c] px-4 py-3.5 text-left text-[13px] font-medium text-slate-200">{r.feature}</th>
                    <td className="border-x border-[#fca311]/20 bg-[#fca311]/[0.04] px-4 py-3.5"><span className="flex items-start gap-2 text-[13px] text-slate-300"><MarkIcon mark={r.bukmarkz.mark} />{r.bukmarkz.text}</span></td>
                    <td className="px-4 py-3.5"><span className="flex items-start gap-2 text-[13px] text-slate-300"><MarkIcon mark={r.raindrop.mark} />{r.raindrop.text}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            Raindrop.io details come from raindrop.io and help.raindrop.io, read on {CHECKED_ON}. &ldquo;Not stated&rdquo; means their site does not mention it, which is not the same as not having it. Plans change, so check each product for current details. Bukmarkz is in early access.
          </p>
        </Section>

        {/* ------------------------------------------- raindrop strengths */}
        <Section id="raindrop-stronger" eyebrow="Fair is fair" title="Where Raindrop.io is stronger today" tint>
          <p className="max-w-2xl text-slate-400">Choosing a tool you will actually use matters more than winning a comparison. Here is where Raindrop.io is ahead, and might be the better choice for you.</p>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {[
              ['Apps everywhere', 'Browser extensions for Chrome, Firefox, Safari and Edge, desktop apps for Windows and macOS, and mobile apps for iPhone, iPad and Android. Bukmarkz has a Chrome extension and a web app.'],
              ['Search inside what you saved', 'Raindrop Pro searches the full content of saved pages, PDFs and YouTube videos. Bukmarkz searches titles, notes and descriptions by meaning.'],
              ['Years of polish', 'Raindrop.io is an established product with an API, automatic backups and AI tools that connect to Claude and ChatGPT. Bukmarkz is new.'],
              ['Highlights', 'Annotate passages on a page and come back to them. Bukmarkz has notes on each save, but not page highlights yet.'],
            ].map(([t, d]) => (
              <li key={t} className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
                <h3 className="font-semibold text-white">{t}</h3>
                <p className="mt-1.5 text-sm text-slate-400">{d}</p>
              </li>
            ))}
          </ul>
        </Section>

        {/* ---------------------------------------- bukmarkz difference */}
        <Section id="why-bukmarkz" eyebrow="Why people switch" title="Why try Bukmarkz as your Raindrop alternative">
          <ul className="grid gap-4 md:grid-cols-3">
            {WHY.map(({ icon: I, title, text }) => (
              <li key={title} className="rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent p-5">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#fca311]/10 text-[#fca311]"><I className="h-4 w-4" aria-hidden /></span>
                <h3 className="mt-4 font-semibold text-white">{title}</h3>
                <p className="mt-1.5 text-sm text-slate-400">{text}</p>
              </li>
            ))}
          </ul>
          <p className="mt-6 flex items-start gap-2 text-sm text-slate-400"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#fca311]" aria-hidden="true" />Coming next: AI action checklists that break a saved article into three small steps. We will not list it as available until it is.</p>
        </Section>

        {/* ------------------------------------------------------ switch */}
        <Section id="switch" eyebrow="Import" title="Switch from Raindrop.io to Bukmarkz in three steps" tint>
          <ol className="grid gap-4 md:grid-cols-3">
            {STEPS.map(({ icon: I, title, text }, i) => (
              <li key={title} className="relative rounded-xl border border-white/10 bg-white/[0.02] p-5">
                <span className="absolute right-4 top-4 font-mono text-xs text-slate-600" aria-hidden="true">0{i + 1}</span>
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#fca311]/10 text-[#fca311]"><I className="h-4 w-4" aria-hidden /></span>
                <h3 className="mt-4 font-semibold text-white"><span className="sr-only">Step {i + 1}: </span>{title}</h3>
                <p className="mt-1.5 text-sm text-slate-400">{text}</p>
              </li>
            ))}
          </ol>
          <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.02] p-5">
            <h3 className="font-semibold text-white">What comes across, and what does not</h3>
            <div className="mt-3 grid gap-4 text-sm sm:grid-cols-2">
              <div><p className="font-medium text-emerald-300">Comes across</p><p className="mt-1 text-slate-400">Links, titles and folders (as Bukmarkz categories).</p></div>
              <div><p className="font-medium text-amber-300">Does not come across yet</p><p className="mt-1 text-slate-400">Tags, highlights, reminders and uploaded files. Your Raindrop copies stay where they are.</p></div>
            </div>
          </div>
        </Section>

        {/* ----------------------------------------------------- CTA */}
        <section aria-labelledby="cta-title" className="px-4 py-16 sm:px-6 sm:py-20">
          <div className="relative mx-auto max-w-4xl overflow-hidden rounded-2xl border border-[#fca311]/30 bg-gradient-to-b from-[#1a1409] to-[#0b1020] px-6 py-14 text-center">
            <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-0 h-40 w-[500px] -translate-x-1/2 rounded-full bg-[#fca311]/20 blur-3xl" />
            <h2 id="cta-title" className="relative text-balance text-3xl font-semibold tracking-tight text-white sm:text-4xl">Import your Raindrop bookmarks and get {TRIAL_MONTHS} months free Pro</h2>
            <p className="relative mx-auto mt-3 max-w-lg text-slate-400">No credit card required. After the trial, Pro is ${PRICE.proMonthly} a month or ${PRICE.proAnnual} a year. You do not need to cancel Raindrop to try it.</p>
            <a href={LINKS.claim} className={`${amberBtn} relative mt-7`}>Claim {TRIAL_MONTHS} Months Free Pro <ArrowRight className="h-4 w-4" aria-hidden="true" /></a>
          </div>
        </section>

        {/* ----------------------------------------------------- FAQ */}
        <Section id="faq" eyebrow="FAQ" title="Raindrop.io alternative: common questions" tint>
          <div className="divide-y divide-white/[0.07] rounded-xl border border-white/10 bg-white/[0.02]">
            {FAQ.map((f) => (
              <details key={f.q} className="group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#fca311] [&::-webkit-details-marker]:hidden">
                  <h3 className="text-[15px] font-medium">{f.q}</h3>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-500 transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-slate-400">{f.a}</p>
              </details>
            ))}
          </div>
        </Section>
      </main>

      <footer className="border-t border-white/[0.06] px-4 py-10 sm:px-6">
        <div className="mx-auto max-w-4xl space-y-3 text-center text-xs leading-relaxed text-slate-500">
          <p>Raindrop.io is a trademark of its owner. Bukmarkz is not affiliated with or endorsed by Raindrop.io. Comparison checked {CHECKED_ON}.</p>
          <p><a href={LINKS.home} className="hover:text-slate-300">Bukmarkz home</a> · <a href={LINKS.pricing} className="hover:text-slate-300">Pricing</a> · <a href="/privacy" className="hover:text-slate-300">Privacy</a> · <a href="/terms" className="hover:text-slate-300">Terms</a></p>
        </div>
      </footer>
    </div>
  );
}
