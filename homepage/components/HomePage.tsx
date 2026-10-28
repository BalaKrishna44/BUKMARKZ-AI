'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import {
  ArrowRight, Bell, Bookmark, Check, ChevronDown, Chrome, Clock, Gift, ListChecks,
  Menu, MessageCircle, Minus, Play, Search, Smartphone, Sparkles, Users, X,
} from 'lucide-react';
import { FAQS, PRICE, SAVE_PERCENT, TRIAL_MONTHS, usd } from '@/lib/site-data';

/* ==========================================================================
   Edit this block first. Everything the page claims is driven from here.
   ========================================================================== */

const LINKS = {
  signIn: '/login',
  claim: '/signup?plan=pro-trial',
  free: '/signup?plan=free',
  sales: 'mailto:sales@bukmarkz.com?subject=Bukmarkz%20Team%20plan',
  privacy: '/privacy',
  terms: '/terms',
};

/** Flip each to 'live' only when it is true for real users. 'soon' and 'beta' render honest badges. */
type Status = 'live' | 'beta' | 'soon';
const STATUS = {
  webApp: 'beta',
  chromeSave: 'beta',      // flip to 'live' once the extension is in the Chrome Web Store
  mobileShare: 'soon',
  chatBots: 'soon',        // WhatsApp / Telegram
  checklists: 'soon',      // AI action checklists ("Oneclist")
  vaultSearch: 'beta',
  smartReminders: 'soon',
} satisfies Record<string, Status>;

/** Add real entries only when they are true, e.g. { name: 'Product Hunt', href: 'https://...' }. Empty = the strip is not shown. */
const FEATURED_ON: Array<{ name: string; href: string }> = [];


/* ============================================================== primitives */

const amberBtn = 'inline-flex items-center justify-center gap-2 rounded-lg bg-[#fca311] px-4 py-2.5 text-sm font-semibold text-[#14213d] shadow-[0_8px_30px_-10px_rgba(252,163,17,0.9)] transition-colors hover:bg-[#ffb23e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';
const ghostBtn = 'inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-100 transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fca311]';

function StatusChip({ status }: { status: Status }) {
  const map = {
    live: ['Available', 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/20'],
    beta: ['Beta', 'bg-amber-400/10 text-amber-300 ring-amber-400/20'],
    soon: ['Coming soon', 'bg-slate-400/10 text-slate-300 ring-slate-400/20'],
  } as const;
  const [label, cls] = map[status];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ring-inset ${cls}`}>{label}</span>;
}

function Logo() {
  return (
    <span className="flex items-center gap-2">
      <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-[#ffd27a] via-[#fca311] to-[#e08600] text-[#14213d]">
        <Bookmark className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-white">Bukmarkz <span className="text-[#fca311]">AI</span></span>
    </span>
  );
}

function SectionHead({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <header className="mx-auto max-w-2xl text-center">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#fca311]">{eyebrow}</p>
      <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight text-white sm:text-4xl">{title}</h2>
      {sub && <p className="mt-3 text-pretty text-base text-slate-400">{sub}</p>}
    </header>
  );
}

const useReducedMotion = () => {
  const [r, setR] = useState(false);
  useEffect(() => {
    const q = window.matchMedia('(prefers-reduced-motion: reduce)');
    setR(q.matches);
    const on = () => setR(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return r;
};

/* ================================================================== page */

export default function HomePage() {
  const [demoToken, setDemoToken] = useState(0);
  const watchDemo = useCallback(() => {
    document.getElementById('demo')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    setDemoToken((t) => t + 1);
  }, []);

  return (
    <div className="min-h-screen bg-[#05070d] text-slate-300 antialiased selection:bg-[#fca311]/30">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-[#fca311] focus:px-3 focus:py-2 focus:text-[#14213d]">Skip to content</a>
      <NavBar />
      <main id="main">
        <Hero onWatchDemo={watchDemo} demoToken={demoToken} />
        <ProofWall />
        <Pillars />
        <Comparison />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

/* ================================================================== nav */

const NAV = [['Features', '#features'], ['Pricing', '#pricing'], ['Comparison', '#comparison'], ['FAQ', '#faq']] as const;

function NavBar() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const esc = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);

  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#05070d]/80 backdrop-blur-xl">
      <nav aria-label="Main" className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <a href="#" aria-label="Bukmarkz home" className="rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#fca311]"><Logo /></a>
        <ul className="hidden items-center gap-1 md:flex">
          {NAV.map(([label, href]) => (
            <li key={href}><a href={href} className="rounded-md px-3 py-1.5 text-sm text-slate-400 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#fca311]">{label}</a></li>
          ))}
        </ul>
        <div className="hidden items-center gap-2 md:flex">
          <a href={LINKS.signIn} className="rounded-md px-3 py-1.5 text-sm text-slate-300 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#fca311]">Sign In</a>
          <a href={LINKS.claim} className={amberBtn}>Claim {TRIAL_MONTHS} Months Free</a>
        </div>
        <button type="button" className="rounded-md p-2 text-slate-300 hover:bg-white/5 md:hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#fca311]" aria-expanded={open} aria-controls="mobile-menu" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen(!open)}>
          {open ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
        </button>
      </nav>
      {open && (
        <div id="mobile-menu" className="border-t border-white/[0.06] bg-[#05070d] px-4 pb-4 pt-2 md:hidden">
          <ul className="space-y-1">
            {NAV.map(([label, href]) => (
              <li key={href}><a href={href} onClick={() => setOpen(false)} className="block rounded-md px-3 py-2.5 text-sm text-slate-200 hover:bg-white/5">{label}</a></li>
            ))}
            <li><a href={LINKS.signIn} className="block rounded-md px-3 py-2.5 text-sm text-slate-200 hover:bg-white/5">Sign In</a></li>
          </ul>
          <a href={LINKS.claim} className={`${amberBtn} mt-3 w-full`}>Claim {TRIAL_MONTHS} Months Free</a>
        </div>
      )}
    </header>
  );
}

/* ================================================================== hero */

function Hero({ onWatchDemo, demoToken }: { onWatchDemo: () => void; demoToken: number }) {
  return (
    <section className="relative isolate overflow-hidden px-4 pb-16 pt-14 sm:px-6 sm:pb-24 sm:pt-20">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_30%,#000_30%,transparent_80%)]" />
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-[-120px] -z-10 h-[460px] w-[900px] -translate-x-1/2 rounded-full bg-[#fca311]/[0.12] blur-3xl" />

      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="text-center lg:text-left">
          <a href="#pricing" className="inline-flex items-center gap-2 rounded-full border border-[#fca311]/30 bg-[#fca311]/10 px-3 py-1 text-xs font-medium text-[#ffcf70] hover:bg-[#fca311]/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#fca311]">
            <Gift className="h-3.5 w-3.5" aria-hidden="true" /> Early access: {TRIAL_MONTHS} months of Pro free <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </a>
          <h1 className="mt-5 text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-white sm:text-6xl">
            Stop letting bookmarks <span className="bg-gradient-to-r from-[#ffd27a] to-[#fca311] bg-clip-text text-transparent">rot</span>.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-pretty text-lg text-slate-400 lg:mx-0">
            Bukmarkz is where saved links, notes and reminders turn into things you actually do. Save in one click, find anything by describing it, and get nudged before it goes stale.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
            <a href={LINKS.claim} className={`${amberBtn} w-full px-5 py-3 text-base sm:w-auto`}>Claim {TRIAL_MONTHS} Months Free Pro <ArrowRight className="h-4 w-4" aria-hidden="true" /></a>
            <button type="button" onClick={onWatchDemo} className={`${ghostBtn} w-full px-5 py-3 text-base sm:w-auto`}><Play className="h-4 w-4" aria-hidden="true" /> Watch Demo</button>
          </div>
          <ul className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-slate-400 lg:justify-start">
            {['No credit card required', `${TRIAL_MONTHS} months of Pro, free`, 'Private saves stay on your device'].map((t) => (
              <li key={t} className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-[#fca311]" aria-hidden="true" />{t}</li>
            ))}
          </ul>
        </div>
        <DemoCard playToken={demoToken} />
      </div>
    </section>
  );
}

/* ----------------------------------------------- interactive BUK & MARKZ card */

type Who = 'you' | 'buk' | 'markz';
interface Line { who: Who; text: string }
interface Script { label: string; icon: ReactNode; lines: Line[]; results?: Array<{ title: string; site: string; match: string }> }

const SCRIPTS: Record<string, Script> = {
  vault: {
    label: 'Ask My Vault',
    icon: <Search className="h-3.5 w-3.5" aria-hidden="true" />,
    lines: [
      { who: 'you', text: 'that article about cheap vegetarian dinners I saved' },
      { who: 'markz', text: 'OOH OOH I know this one!! I think?? It had… a lentil? BUK, was it a lentil?!' },
      { who: 'buk', text: 'Calm, MARKZ. The vault does not search for words. It searches for meaning. Three saves matched.' },
    ],
    results: [
      { title: '12 weeknight dinners under $3 a head', site: 'seriouseats.example', match: '94%' },
      { title: 'The lazy cook\'s guide to lentils', site: 'bonappetit.example', match: '88%' },
      { title: 'Meal prep for a broke week', site: 'reddit.example', match: '81%' },
    ],
  },
  checklist: {
    label: 'Make a checklist',
    icon: <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />,
    lines: [
      { who: 'you', text: 'turn my saved "How to launch on Product Hunt" post into steps' },
      { who: 'buk', text: 'A link read once is a link forgotten. Here are three small steps.' },
      { who: 'markz', text: '1) Draft the tagline!! 2) Line up five friends!! 3) Hit publish and SCREAM (quietly)!!' },
    ],
  },
  due: {
    label: 'What is due?',
    icon: <Bell className="h-3.5 w-3.5" aria-hidden="true" />,
    lines: [
      { who: 'you', text: 'what should I revisit this week?' },
      { who: 'markz', text: 'Things you said you would read!! Tuesday!! That was yesterday!! Oops!!' },
      { who: 'buk', text: 'Two saves are due. Begin with the shorter one. Momentum is a gentle teacher.' },
    ],
  },
};

const WHO: Record<Who, { name: string; cls: string; badge: string }> = {
  you: { name: 'You', cls: 'bg-white/[0.06] text-slate-100', badge: 'bg-slate-600' },
  buk: { name: 'BUK', cls: 'bg-indigo-400/10 text-indigo-100 ring-1 ring-inset ring-indigo-300/15', badge: 'bg-indigo-400' },
  markz: { name: 'MARKZ', cls: 'bg-[#fca311]/10 text-amber-50 ring-1 ring-inset ring-[#fca311]/20', badge: 'bg-[#fca311]' },
};

function DemoCard({ playToken }: { playToken: number }) {
  const reduced = useReducedMotion();
  const [key, setKey] = useState<keyof typeof SCRIPTS>('vault');
  const [shown, setShown] = useState(0);
  const [typing, setTyping] = useState<Who | null>(null);
  const [started, setStarted] = useState(false);
  const timers = useRef<number[]>([]);

  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const play = useCallback((k: keyof typeof SCRIPTS) => {
    clear();
    setKey(k); setStarted(true); setShown(0); setTyping(null);
    const lines = SCRIPTS[k].lines;
    if (reduced) { setShown(lines.length); return; }
    let t = 250;
    lines.forEach((line, i) => {
      timers.current.push(window.setTimeout(() => setTyping(line.who === 'you' ? null : line.who), t));
      t += line.who === 'you' ? 450 : 1100;
      timers.current.push(window.setTimeout(() => { setShown(i + 1); setTyping(null); }, t));
      t += 350;
    });
  }, [reduced]);

  useEffect(() => { if (playToken > 0) play('vault'); }, [playToken, play]);
  useEffect(() => clear, []);
  // First visit: start the demo so the card is never an empty box.
  useEffect(() => { play('vault'); }, [play]);

  const script = SCRIPTS[key];
  const done = shown >= script.lines.length;

  return (
    <div id="demo" className="scroll-mt-24">
      <div className="relative rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-1 shadow-[0_30px_80px_-30px_rgba(252,163,17,0.35)]">
        <div className="rounded-[14px] bg-[#0a0e1a] p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5" aria-hidden="true"><span className="h-2.5 w-2.5 rounded-full bg-white/10" /><span className="h-2.5 w-2.5 rounded-full bg-white/10" /><span className="h-2.5 w-2.5 rounded-full bg-white/10" /></div>
            <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Sample conversation</span>
          </div>

          <div role="group" aria-label="Try a demo" className="mt-3 flex flex-wrap gap-2">
            {Object.entries(SCRIPTS).map(([k, s]) => (
              <button key={k} type="button" aria-pressed={started && key === k} onClick={() => play(k)} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#fca311] ${started && key === k ? 'border-[#fca311]/60 bg-[#fca311]/15 text-[#ffcf70]' : 'border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200'}`}>
                {s.icon}{s.label}
              </button>
            ))}
          </div>

          <div className="mt-4 min-h-[280px] space-y-3" role="log" aria-live="polite" aria-label="Demo conversation">
            {script.lines.slice(0, shown).map((l, i) => (
              <div key={`${key}-${i}`} className={`flex gap-2.5 ${l.who === 'you' ? 'justify-end' : ''}`}>
                {l.who !== 'you' && <span className={`mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[9px] font-bold text-[#0a0e1a] ${WHO[l.who].badge}`} aria-hidden="true">{l.who === 'buk' ? 'B' : 'M'}</span>}
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[13px] leading-snug ${WHO[l.who].cls}`}>
                  {l.who !== 'you' && <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider opacity-70">{WHO[l.who].name}</span>}
                  {l.text}
                </div>
              </div>
            ))}
            {typing && (
              <div className="flex items-center gap-2.5" aria-label={`${WHO[typing].name} is typing`}>
                <span className={`grid h-6 w-6 place-items-center rounded-full text-[9px] font-bold text-[#0a0e1a] ${WHO[typing].badge}`} aria-hidden="true">{typing === 'buk' ? 'B' : 'M'}</span>
                <span className="flex gap-1 rounded-xl bg-white/[0.06] px-3 py-2.5" aria-hidden="true">
                  {[0, 1, 2].map((d) => <span key={d} className="h-1.5 w-1.5 rounded-full bg-slate-400 motion-safe:animate-bounce" style={{ animationDelay: `${d * 120}ms` }} />)}
                </span>
              </div>
            )}
            {done && script.results && (
              <ul className="space-y-1.5 pl-8" aria-label="Matching saves">
                {script.results.map((r) => (
                  <li key={r.title} className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2">
                    <span className="min-w-0"><span className="block truncate text-[13px] text-slate-100">{r.title}</span><span className="block truncate text-[11px] text-slate-500">{r.site}</span></span>
                    <span className="shrink-0 rounded bg-emerald-400/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">{r.match}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
      <p className="mt-2 text-center text-[11px] text-slate-500">A scripted preview of the BUK and MARKZ assistants. Titles and matches are illustrative.</p>
    </div>
  );
}

/* ============================================================ proof wall */

function ProofWall() {
  const platforms: Array<[ReactNode, string, Status]> = [
    [<Bookmark key="w" className="h-4 w-4" aria-hidden="true" />, 'Web app', STATUS.webApp],
    [<Chrome key="c" className="h-4 w-4" aria-hidden="true" />, 'Chrome extension', STATUS.chromeSave],
    [<Smartphone key="m" className="h-4 w-4" aria-hidden="true" />, 'iOS and Android share sheet', STATUS.mobileShare],
    [<MessageCircle key="b" className="h-4 w-4" aria-hidden="true" />, 'WhatsApp and Telegram', STATUS.chatBots],
  ];
  return (
    <section aria-label={FEATURED_ON.length ? 'As featured on' : 'Where you can save from'} className="border-y border-white/[0.06] bg-white/[0.015] px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-6xl">
        {FEATURED_ON.length > 0 ? (
          <>
            <p className="text-center font-mono text-xs uppercase tracking-[0.2em] text-slate-500">As featured on</p>
            <ul className="mt-5 flex flex-wrap items-center justify-center gap-x-10 gap-y-3">
              {FEATURED_ON.map((f) => <li key={f.name}><a href={f.href} rel="noopener noreferrer" target="_blank" className="text-lg font-semibold text-slate-400 hover:text-white">{f.name}</a></li>)}
            </ul>
          </>
        ) : (
          <>
            <p className="text-center font-mono text-xs uppercase tracking-[0.2em] text-slate-500">Save from anywhere</p>
            <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {platforms.map(([icon, label, status]) => (
                <li key={label} className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3.5 py-2.5 text-sm text-slate-300">
                  <span className="flex items-center gap-2.5 text-slate-200">{icon}{label}</span><StatusChip status={status} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

/* ============================================================ 4 pillars */

interface Pillar { id: string; tab: string; icon: ReactNode; status: Status; title: string; body: string; points: string[]; mock: ReactNode }

function MockWindow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0a0e1a] p-4" role="img" aria-label={label}>
      <div className="space-y-2" aria-hidden="true">{children}</div>
    </div>
  );
}
const Row = ({ children, accent = false }: { children: ReactNode; accent?: boolean }) => (
  <div className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-[13px] ${accent ? 'border-[#fca311]/30 bg-[#fca311]/10 text-amber-50' : 'border-white/[0.07] bg-white/[0.03] text-slate-300'}`}>{children}</div>
);

const PILLARS: Pillar[] = [
  {
    id: 'save', tab: '1-Click Save', icon: <Bookmark className="h-4 w-4" aria-hidden="true" />, status: STATUS.chromeSave,
    title: 'Save from wherever you are reading',
    body: 'Press Cmd/Ctrl+Shift+S on any page. Add a quick note, a tag and a reminder without leaving the tab.',
    points: ['Chrome extension with an in-page save panel', 'Private windows: saves stay on your device only', 'iOS and Android share sheets and WhatsApp or Telegram saving are on the way'],
    mock: (
      <MockWindow label="Preview of the save panel with title, note, tags and reminder">
        <Row><span className="text-slate-100">How vector search works</span><Bookmark className="h-3.5 w-3.5 text-[#fca311]" /></Row>
        <Row><span className="text-slate-500">Why does this matter?</span></Row>
        <div className="flex gap-1.5"><span className="rounded-full bg-[#fca311] px-2 py-0.5 text-[11px] font-semibold text-[#14213d]">#search</span><span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px]">#ai</span></div>
        <Row><span>Remind me</span><span className="text-slate-100">Tomorrow, 9 am</span></Row>
        <Row accent><span className="font-semibold">Save</span><span className="font-mono text-[11px] opacity-70">Ctrl+Enter</span></Row>
      </MockWindow>
    ),
  },
  {
    id: 'checklists', tab: 'AI Action Checklists', icon: <ListChecks className="h-4 w-4" aria-hidden="true" />, status: STATUS.checklists,
    title: 'Turn what you saved into what you do',
    body: 'Oneclist reads a saved article or post and proposes a short checklist, so a link becomes a next step instead of a tab you never reopen.',
    points: ['Three clear steps per save, editable', 'Tick them off in your inbox', 'Private saves are never sent to AI'],
    mock: (
      <MockWindow label="Preview of a three-step checklist generated from a saved article">
        <Row><span className="text-slate-100">Launching on Product Hunt</span><Sparkles className="h-3.5 w-3.5 text-[#fca311]" /></Row>
        {['Write a one-line tagline', 'Ask five friends to be around at launch', 'Schedule the post for 12:01 am PT'].map((s, i) => (
          <Row key={s}><span className="flex items-center gap-2"><span className={`grid h-4 w-4 place-items-center rounded border ${i === 0 ? 'border-[#fca311] bg-[#fca311] text-[#14213d]' : 'border-white/20'}`}>{i === 0 && <Check className="h-3 w-3" />}</span><span className={i === 0 ? 'text-slate-500 line-through' : ''}>{s}</span></span></Row>
        ))}
      </MockWindow>
    ),
  },
  {
    id: 'search', tab: 'Ask My Vault', icon: <Search className="h-4 w-4" aria-hidden="true" />, status: STATUS.vaultSearch,
    title: 'Describe it. We will find it.',
    body: 'Search by meaning, not exact words. "That piece about cheap vegetarian dinners" finds the lentil article even if it never says "cheap".',
    points: ['Meaning-based (vector) search with a keyword fallback', 'Only your own saves, never other people\'s', 'Private categories are left out of AI search'],
    mock: (
      <MockWindow label="Preview of a natural-language search with ranked results">
        <Row accent><span className="flex items-center gap-2"><Search className="h-3.5 w-3.5" />cheap vegetarian dinners</span></Row>
        {[['12 weeknight dinners under $3', '94%'], ['The lazy cook\'s guide to lentils', '88%'], ['Meal prep for a broke week', '81%']].map(([t, m]) => <Row key={t}><span className="truncate text-slate-100">{t}</span><span className="font-mono text-[11px] text-emerald-300">{m}</span></Row>)}
      </MockWindow>
    ),
  },
  {
    id: 'reminders', tab: 'Smart 48h Reminders', icon: <Clock className="h-4 w-4" aria-hidden="true" />, status: STATUS.smartReminders,
    title: 'Come back while it still matters',
    body: 'Set your own reminder today. Smart reminders, which nudge you about unread saves around the 48-hour mark, are in development.',
    points: ['Your own reminders: this evening, tomorrow, in 3 days, next Monday', 'Browser notifications that open the page', 'Private reminders never show the title'],
    mock: (
      <MockWindow label="Preview of a reminder notification">
        <Row accent><span className="flex items-center gap-2"><Bell className="h-3.5 w-3.5" />Time to revisit</span><span className="text-[11px] opacity-70">now</span></Row>
        <Row><span className="truncate text-slate-100">How vector search works</span></Row>
        <Row><span className="text-slate-500">Saved 2 days ago · #search</span></Row>
      </MockWindow>
    ),
  },
];

function Pillars() {
  const [active, setActive] = useState(0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = PILLARS.length - 1;
    const next = e.key === 'ArrowRight' ? (active === last ? 0 : active + 1) : e.key === 'ArrowLeft' ? (active === 0 ? last : active - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last : -1;
    if (next < 0) return;
    e.preventDefault(); setActive(next); refs.current[next]?.focus();
  };
  const p = PILLARS[active];

  return (
    <section id="features" className="scroll-mt-16 px-4 py-20 sm:px-6 sm:py-28">
      <div className="mx-auto max-w-6xl">
        <SectionHead eyebrow="Features" title="Four things that make a saved link useful" sub="Most tools stop at saving. Bukmarkz is built for the part after: finding it, acting on it, and remembering it." />
        <div role="tablist" aria-label="Feature pillars" onKeyDown={onKey} className="mx-auto mt-10 flex max-w-3xl gap-1 overflow-x-auto rounded-xl border border-white/10 bg-white/[0.03] p-1">
          {PILLARS.map((t, i) => (
            <button key={t.id} ref={(el) => { refs.current[i] = el; }} role="tab" id={`tab-${t.id}`} aria-selected={i === active} aria-controls={`panel-${t.id}`} tabIndex={i === active ? 0 : -1} type="button" onClick={() => setActive(i)}
              className={`flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#fca311] ${i === active ? 'bg-white/10 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}>
              <span className={i === active ? 'text-[#fca311]' : ''}>{t.icon}</span>{t.tab}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`panel-${p.id}`} aria-labelledby={`tab-${p.id}`} tabIndex={0} className="mx-auto mt-8 grid max-w-5xl grid-cols-1 items-center gap-8 rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent p-6 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#fca311] sm:p-8 md:grid-cols-2">
          <div>
            <StatusChip status={p.status} />
            <h3 className="mt-3 text-2xl font-semibold tracking-tight text-white">{p.title}</h3>
            <p className="mt-3 text-slate-400">{p.body}</p>
            <ul className="mt-5 space-y-2.5 text-sm">
              {p.points.map((pt) => <li key={pt} className="flex gap-2.5"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#fca311]" aria-hidden="true" /><span className="text-slate-300">{pt}</span></li>)}
            </ul>
          </div>
          {p.mock}
        </div>
      </div>
    </section>
  );
}

/* ========================================================== comparison */

type Cell = { kind: 'yes' | 'no' | 'partial' | 'text'; text?: string; note?: string };
const Y = (text?: string, note?: string): Cell => ({ kind: 'yes', text, note });
const N = (text?: string, note?: string): Cell => ({ kind: 'no', text, note });
const P = (text?: string, note?: string): Cell => ({ kind: 'partial', text, note });
const T = (text: string): Cell => ({ kind: 'text', text });

/** Competitor facts checked on 20 Oct 2026 from raindrop.io/pro, Engadget (Pocket) and a ContextBolt review (Notion). Re-check before launch: plans change. */
const COMPARE_ROWS: Array<{ feature: string; bukmarkz: Cell; raindrop: Cell; pocket: Cell; notion: Cell }> = [
  { feature: 'Available today', bukmarkz: P('Early access'), raindrop: Y(), pocket: N('Shut down 8 Jul 2025'), notion: Y() },
  { feature: 'Reminders on saved items', bukmarkz: P('Yes, smart ones soon'), raindrop: Y('Pro'), pocket: N(), notion: P('Via date properties') },
  { feature: 'AI help with your saves', bukmarkz: P('Beta'), raindrop: Y('Pro: AI Assistant and Suggestions'), pocket: N(), notion: Y('Notion AI, paid') },
  { feature: 'Search by meaning', bukmarkz: P('Beta, in Pro'), raindrop: P('Full-text search on Pro'), pocket: N(), notion: P('Needs Notion AI', 'Reported on the Business plan, about $20 per member per month') },
  { feature: 'Private saves kept on your device', bukmarkz: Y('Chrome private windows'), raindrop: T('Not advertised'), pocket: N(), notion: T('Not advertised') },
  { feature: 'Paid plan price', bukmarkz: T(`${usd(PRICE.proMonthly)}/mo or ${usd(PRICE.proAnnual).replace('.00', '')}/yr`), raindrop: T('See raindrop.io'), pocket: T('n/a'), notion: T('Varies by plan') },
];

function CellView({ c }: { c: Cell }) {
  const icon = c.kind === 'yes' ? <Check className="h-4 w-4 text-emerald-400" aria-hidden="true" /> : c.kind === 'no' ? <X className="h-4 w-4 text-slate-600" aria-hidden="true" /> : c.kind === 'partial' ? <Minus className="h-4 w-4 text-amber-400" aria-hidden="true" /> : null;
  const sr = c.kind === 'yes' ? 'Yes' : c.kind === 'no' ? 'No' : c.kind === 'partial' ? 'Partly' : '';
  return (
    <span className="flex flex-col items-center gap-0.5 text-center" title={c.note}>
      {icon}
      {sr && <span className="sr-only">{sr}. </span>}
      {c.text && <span className="text-[12px] leading-tight text-slate-400">{c.text}</span>}
    </span>
  );
}

function Comparison() {
  return (
    <section id="comparison" className="scroll-mt-16 border-y border-white/[0.06] bg-white/[0.015] px-4 py-20 sm:px-6 sm:py-28">
      <div className="mx-auto max-w-5xl">
        <SectionHead eyebrow="Comparison" title="How Bukmarkz compares" sub="An honest look. Where others are strong, the table says so." />
        <div className="relative mt-10 overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <caption className="sr-only">Feature comparison of Bukmarkz, Raindrop.io, Pocket and Notion</caption>
            <thead>
              <tr className="bg-white/[0.03]">
                <th scope="col" className="sticky left-0 z-10 bg-[#0b0f1c] px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Feature</th>
                <th scope="col" className="border-x border-[#fca311]/30 bg-[#fca311]/[0.07] px-3 py-3 text-center text-sm font-semibold text-[#ffcf70]">Bukmarkz</th>
                {['Raindrop.io', 'Pocket', 'Notion'].map((n) => <th key={n} scope="col" className="px-3 py-3 text-center text-sm font-medium text-slate-300">{n}</th>)}
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map((r) => (
                <tr key={r.feature} className="border-t border-white/[0.06]">
                  <th scope="row" className="sticky left-0 z-10 bg-[#0b0f1c] px-4 py-3.5 text-left text-[13px] font-medium text-slate-200">{r.feature}</th>
                  <td className="border-x border-[#fca311]/20 bg-[#fca311]/[0.04] px-3 py-3.5"><CellView c={r.bukmarkz} /></td>
                  <td className="px-3 py-3.5"><CellView c={r.raindrop} /></td>
                  <td className="px-3 py-3.5"><CellView c={r.pocket} /></td>
                  <td className="px-3 py-3.5"><CellView c={r.notion} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-center text-xs text-slate-500">Competitor details checked 20 Oct 2026 from their own pages and public reporting. Plans change; check each product for current details. All product names belong to their owners.</p>
      </div>
    </section>
  );
}

/* ============================================================== pricing */

type Value = boolean | string;
const FEATURES: Array<{ label: string; free: Value; pro: Value; team: Value; status?: Status }> = [
  // NOTE: limits are placeholders. Replace with your real quotas.
  { label: 'Saved links', free: 'Up to 100', pro: 'Unlimited', team: 'Unlimited' },
  { label: 'AI actions', free: '10 per month', pro: '500 per month', team: '1,500 per user / month' },
  { label: '1-click share sheet', free: true, pro: true, team: true, status: STATUS.chromeSave },
  { label: 'Permanent web archiving', free: false, pro: true, team: true, status: 'soon' },
  { label: 'Vector (meaning-based) search', free: false, pro: true, team: true, status: STATUS.vaultSearch },
  { label: 'WhatsApp and Telegram bot', free: false, pro: true, team: true, status: STATUS.chatBots },
];

function Pricing() {
  const [annual, setAnnual] = useState(false);
  const proPerMonth = annual ? PRICE.proAnnual / 12 : PRICE.proMonthly;

  return (
    <section id="pricing" className="scroll-mt-16 px-4 py-20 sm:px-6 sm:py-28">
      <div className="mx-auto max-w-6xl">
        <SectionHead eyebrow="Pricing" title={`Start with ${TRIAL_MONTHS} months of Pro, free`} sub="No credit card needed to start." />
        <div className="mt-8 flex items-center justify-center gap-3 text-sm">
          <span className={annual ? 'text-slate-500' : 'font-medium text-white'}>Monthly</span>
          <button type="button" role="switch" aria-checked={annual} aria-label="Bill annually" onClick={() => setAnnual(!annual)}
            className={`relative h-6 w-11 rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fca311] ${annual ? 'border-[#fca311] bg-[#fca311]' : 'border-slate-600 bg-slate-800'}`}>
            <span aria-hidden="true" className={`absolute left-0.5 top-0.5 h-[18px] w-[18px] rounded-full shadow transition-transform motion-reduce:transition-none ${annual ? 'translate-x-5 bg-[#14213d]' : 'bg-white'}`} />
          </button>
          <span className={annual ? 'font-medium text-white' : 'text-slate-500'}>Annual</span>
          <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-400/20">Save {SAVE_PERCENT}%</span>
        </div>

        <div className="mt-12 grid grid-cols-1 items-stretch gap-5 md:grid-cols-3 lg:gap-6">
          <PlanCard name="Free" blurb="For trying Bukmarkz and light saving." plan="free">
            <PriceTag amount="$0" unit="forever" />
            <p className="mt-1 min-h-[2.5rem] text-sm text-slate-500">&nbsp;</p>
            <a href={LINKS.free} className={`${ghostBtn} mt-2 w-full`}>Get Started Free</a>
          </PlanCard>

          <PlanCard name="Pro" blurb="Everything unlocked for people who live in their bookmarks." plan="pro" featured>
            <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
              <div className="relative">
                <span aria-hidden="true" className="absolute inset-0 rounded-full bg-[#fca311] opacity-60 blur-lg motion-safe:animate-pulse" />
                <span className="relative inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-gradient-to-r from-[#ffd27a] via-[#fca311] to-[#e08600] px-3.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[#14213d]"><Gift className="h-3.5 w-3.5" aria-hidden="true" />{TRIAL_MONTHS} Months Free Trial</span>
              </div>
            </div>
            <div className="flex items-end gap-2">
              {annual && <span className="pb-1 text-lg text-slate-600 line-through"><span className="sr-only">was </span>{usd(PRICE.proMonthly)}</span>}
              <PriceTag amount={usd(proPerMonth)} unit="/ month" live />
            </div>
            <p className="mt-1 min-h-[2.5rem] text-sm text-slate-500" aria-live="polite">{annual ? `Billed ${usd(PRICE.proAnnual)} per year.` : 'Billed monthly.'} <span className="text-slate-300">Free for {TRIAL_MONTHS} months first.</span></p>
            <a href={LINKS.claim} className={`${amberBtn} mt-2 w-full`}>Claim {TRIAL_MONTHS} Months Free Pro</a>
          </PlanCard>

          <PlanCard name="Team" blurb="Shared knowledge for teams that research together." plan="team" icon={<Users className="h-4 w-4 text-slate-500" aria-hidden="true" />}>
            <PriceTag amount={usd(PRICE.teamMonthly)} unit="/ user / month" />
            <p className="mt-1 min-h-[2.5rem] text-sm text-slate-500">Annual and volume pricing from sales.</p>
            <a href={LINKS.sales} className={`${ghostBtn} mt-2 w-full`}>Contact Sales</a>
          </PlanCard>
        </div>
        <p className="mt-8 text-center text-xs text-slate-500">Prices in USD. Pro billing starts only after your {TRIAL_MONTHS}-month free trial ends.</p>
      </div>
    </section>
  );
}

function PlanCard({ name, blurb, plan, featured = false, icon, children }: { name: string; blurb: string; plan: 'free' | 'pro' | 'team'; featured?: boolean; icon?: ReactNode; children: ReactNode }) {
  return (
    <article aria-labelledby={`plan-${plan}`} className={`relative flex flex-col rounded-2xl p-6 ${featured ? 'order-first border border-[#fca311]/70 bg-gradient-to-b from-[#1a1409] via-[#0d0f18] to-[#0b1020] shadow-[0_0_60px_-14px_rgba(252,163,17,0.5)] md:order-none md:-my-3 md:pt-9' : 'border border-white/10 bg-white/[0.02]'}`}>
      <div className="flex items-center gap-2"><h3 id={`plan-${plan}`} className="text-lg font-semibold text-white">{name}</h3>{icon}</div>
      <p className="mt-1 min-h-[2.5rem] text-sm text-slate-400">{blurb}</p>
      <div className="mt-4">{children}</div>
      <ul className="mt-6 space-y-2.5 border-t border-white/[0.07] pt-5 text-sm">
        {FEATURES.map((f) => {
          const v = f[plan]; const on = v !== false;
          return (
            <li key={f.label} className="flex items-start gap-2.5">
              {on ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#fca311]" aria-hidden="true" /> : <Minus className="mt-0.5 h-4 w-4 shrink-0 text-slate-700" aria-hidden="true" />}
              <span className={on ? 'text-slate-200' : 'text-slate-600'}>{f.label}{typeof v === 'string' && <span className="text-slate-500">: {v}</span>}<span className="sr-only">{on ? ' (included)' : ' (not included)'}</span>{on && f.status && f.status !== 'live' && <span className="ml-2 align-middle"><StatusChip status={f.status} /></span>}</span>
            </li>
          );
        })}
      </ul>
    </article>
  );
}

function PriceTag({ amount, unit, live = false }: { amount: string; unit: string; live?: boolean }) {
  return <p className="flex items-baseline gap-1.5" aria-live={live ? 'polite' : undefined}><span className="text-4xl font-semibold tracking-tight text-white">{amount}</span><span className="text-sm text-slate-500">{unit}</span></p>;
}

/* ================================================================== FAQ */

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  const base = useId();
  return (
    <section id="faq" className="scroll-mt-16 border-t border-white/[0.06] px-4 py-20 sm:px-6 sm:py-28">
      <div className="mx-auto max-w-3xl">
        <SectionHead eyebrow="FAQ" title="Questions people ask first" />
        <dl className="mt-10 divide-y divide-white/[0.07] rounded-xl border border-white/10 bg-white/[0.02]">
          {FAQS.map((f, i) => {
            const isOpen = open === i;
            return (
              <div key={f.q}>
                <dt>
                  <button type="button" id={`${base}-q${i}`} aria-expanded={isOpen} aria-controls={`${base}-a${i}`} onClick={() => setOpen(isOpen ? null : i)}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-[15px] font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#fca311]">
                    {f.q}
                    <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform motion-reduce:transition-none ${isOpen ? 'rotate-180 text-[#fca311]' : ''}`} aria-hidden="true" />
                  </button>
                </dt>
                <dd id={`${base}-a${i}`} role="region" aria-labelledby={`${base}-q${i}`} hidden={!isOpen} className="px-5 pb-5 text-sm leading-relaxed text-slate-400">{f.a}</dd>
              </div>
            );
          })}
        </dl>
      </div>
    </section>
  );
}

/* ============================================================ closing */

function FinalCta() {
  return (
    <section className="px-4 pb-24 sm:px-6">
      <div className="relative mx-auto max-w-4xl overflow-hidden rounded-2xl border border-[#fca311]/30 bg-gradient-to-b from-[#1a1409] to-[#0b1020] px-6 py-14 text-center">
        <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-0 h-40 w-[500px] -translate-x-1/2 rounded-full bg-[#fca311]/20 blur-3xl" />
        <h2 className="relative text-balance text-3xl font-semibold tracking-tight text-white sm:text-4xl">Your future self will thank you</h2>
        <p className="relative mx-auto mt-3 max-w-md text-slate-400">Claim {TRIAL_MONTHS} months of Pro. No credit card required.</p>
        <a href={LINKS.claim} className={`${amberBtn} relative mt-7 px-6 py-3 text-base`}>Claim {TRIAL_MONTHS} Months Free Pro <ArrowRight className="h-4 w-4" aria-hidden="true" /></a>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/[0.06] px-4 py-10 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm text-slate-500 sm:flex-row">
        <Logo />
        <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          <li><a href={LINKS.privacy} className="hover:text-slate-300">Privacy</a></li>
          <li><a href={LINKS.terms} className="hover:text-slate-300">Terms</a></li>
          <li><a href={LINKS.sales} className="hover:text-slate-300">Contact</a></li>
        </ul>
        <p>© {new Date().getFullYear()} Bukmarkz</p>
      </div>
    </footer>
  );
}
