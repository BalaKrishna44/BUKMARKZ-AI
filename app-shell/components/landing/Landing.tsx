'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import Wordmark from '@/components/brand/Wordmark';
import { BukWizard, MarkzRobot } from './Characters';
import { FAQS, TRIAL_MONTHS } from '@/lib/site-data';
import { PRICES, formatMoney, type CurrencyCode } from '@/lib/currency';
import './landing.css';

const CLAIM = '/signup?plan=pro-trial';
const SEARCHES: Record<string, [string, string]> = {
  'Find Python snippets': ['python snippets for retrying API calls', '7 snippets in Development, newest saved Tuesday'],
  'Receipts from June': ['receipts from June', '4 receipts found in Receipts'],
  'That RAG article I saved': ['that RAG article I saved', 'Found it: “Hybrid search done right” in Reading'],
  'Videos about pricing': ['videos about pricing', '3 videos in Reading, one with a transcript match'],
};
const TAB_NAMES = ['Docs', 'Cart', 'Thread', 'Map', 'New', 'Video', 'Recipe', 'PDF', 'Tweet', 'Repo', 'Invoice', 'Wiki', 'Blog', 'Mail', 'Docs', 'Slides', 'Cart', 'Paper'];
const FEATURES: [string, string][] = [
  ['Ask by meaning', 'Describe it the way you remember it. Buk finds it, with the page you saved as the source.'],
  ['Auto-files everything', 'Every save lands in a clear category on its own. No folders to maintain.'],
  ['Import in seconds', 'Drop a bookmarks file: 1,000+ links are parsed in your browser and organized, duplicates merged.'],
  ['Flush session', 'Too many tabs? One click saves the whole window as a shareable session with an AI summary, then closes the clutter.'],
  ['Weekly “links you forgot”', 'An opt-in email resurfaces five things you saved and never opened, with a one-tap recall quiz.'],
  ['Works inside Claude & Cursor', 'Your vault becomes a tool your AI can search, save to, and write topic briefs from. Private items are never returned.'],
  ['Stacks you can share', 'Publish a collection as a public page, embed a live card in a README, and let anyone remix it in one click.'],
  ['Price-drop alerts', 'Track a saved product and get one calm email when it falls to your target, with a link to share the deal.'],
  ['Team spaces', 'Tag a colleague on a research stack. They accept by email and join as a viewer. Your personal vault stays private.'],
  ['Friday Vault After-Hours', 'An opt-in Friday 4 PM skit from Markz and Buk, with a one-click nudge to clean up your tabs.'],
];

export default function Landing({ currency }: { currency: CurrencyCode }) {
  const [chip, setChip] = useState('Find Python snippets');
  const [typed, setTyped] = useState(''), [result, setResult] = useState('');
  const [organized, setOrganized] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const tabs = useMemo(() => TAB_NAMES.map((n, i) => ({ n, x: 3 + (i * 53) % 68, y: 14 + (i * 29) % 50, r: ((i % 3) - 1) * 3, d: -(i % 5) })), []);
  const P = PRICES[currency];

  useEffect(() => {
    const [text, answer] = SEARCHES[chip];
    if (timer.current) clearInterval(timer.current);
    setTyped(''); setResult('');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setTyped(text); setResult(answer); return; }
    let i = 0, later: ReturnType<typeof setTimeout> | undefined;
    timer.current = setInterval(() => {
      i += 1; setTyped(text.slice(0, i));
      if (i >= text.length) { if (timer.current) clearInterval(timer.current); later = setTimeout(() => setResult(answer), 300); }
    }, 45);
    return () => { if (timer.current) clearInterval(timer.current); if (later) clearTimeout(later); };
  }, [chip]);

  return (
    <div className="bkl">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=JetBrains+Mono:wght@500&display=swap" />
      <div className="wrap">
        <nav aria-label="Main">
          <Link href="/" className="logo" aria-label="Bukmarkz home"><Wordmark /></Link>
          <div className="links"><a href="#story">How it feels</a><a href="#features">Features</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a></div>
          <div className="navr"><Link className="signin" href="/login">Sign in</Link><Link className="btn p" href={CLAIM}>Get started</Link></div>
        </nav>

        <header className="hero">
          <span className="pill"><b />AI-NATIVE PERSONAL KNOWLEDGE ENGINE</span>
          <h1>Stop Saving Links. <em>Start Building Your Second Brain.</em></h1>
          <p className="lead">Replace chaotic browser tabs with an AI-native vault that auto-files every save, answers questions about what you saved, and turns your bookmarks into interactive knowledge.</p>
          <div className="cta">
            <Link className="btn p" href={CLAIM}>Get Started Free</Link>
            <Link className="btn o" href="/dashboard/extension">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.5" /></svg>Download Chrome Extension
            </Link>
          </div>
          <p className="fine">{TRIAL_MONTHS} months of Pro free. No credit card needed.</p>
          <div className="search">
            <div className="sr"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg><span aria-live="polite">{typed}</span><i className="caret" aria-hidden="true" /></div>
            <div className="chips">{Object.keys(SEARCHES).map((k) => <button key={k} aria-pressed={chip === k} onClick={() => setChip(k)}>{k}</button>)}</div>
            <div className="res" aria-live="polite">{result}</div>
          </div>
        </header>

        <section className="story" id="story">
          <h2>You are Markz. Bukmarkz gives you Buk.</h2>
          <p className="lead">One of them has 400 tabs open and a deadline. The other already knows where everything is.</p>
          <div className={`stage${organized ? ' done' : ''}`}>
            <div className={`panel${organized ? ' sorted' : ''}`}>
              <div className="ph"><span className="tag">BEFORE · MARKZ</span><span>{organized ? '0 tabs open' : '400 tabs open'}</span></div>
              <div aria-hidden="true">{tabs.map((t, i) => <div key={i} className="tab" style={{ left: `${t.x}%`, top: `${t.y}%`, ['--r' as string]: `${t.r}deg`, animationDelay: `${t.d}s` }}>{t.n}</div>)}</div>
              <MarkzRobot className="char markz" />
              <div className="q">“Where did I save that thing about secure data?!”</div>
            </div>
            <div className="panel">
              <div className="ph"><span className="tag g">AFTER · BUK</span><span>{organized ? 'All filed' : 'Waiting for you'}</span></div>
              <div className="cats"><div className="cat">Development <small>128 links</small></div><div className="cat">Reading <small>64 links</small></div><div className="cat">Receipts <small>31 links</small></div><div className="cat">Recipes &amp; Life <small>47 links</small></div></div>
              <BukWizard className="char buk" />
              <div className="q" style={{ right: 185 }}>“Hand me the tabs. I will handle the rest.”</div>
            </div>
          </div>
          <button className="btn p go" onClick={() => setOrganized((v) => !v)}>{organized ? 'Start over' : 'Organize'}</button>
        </section>

        <section id="features" className="sec">
          <h2>Everything your bookmarks were supposed to do</h2>
          <p className="lead">Ten things Bukmarkz does, and one rule behind all of them: private means private.</p>
          <div className="grid">{FEATURES.map(([t, d]) => <div key={t} className="card"><b>{t}</b><span>{d}</span></div>)}</div>
          <div className="note"><b>Private stays private.</b> Items you mark private are never put in stacks, digests, team spaces, shared sessions or AI answers.</div>
        </section>

        <section id="pricing" className="sec">
          <h2>Start with {TRIAL_MONTHS} months of Pro, free</h2>
          <p className="lead">No credit card needed to start.</p>
          <div className="plans">
            <div className="plan"><h3>Free</h3><div className="price">{formatMoney(0, currency)}<small> / month</small></div>
              <ul><li>Save links and notes</li><li>Find them by meaning with AI search</li><li>Chrome extension</li><li>Private saves stay on your device</li></ul>
              <Link className="btn o" href="/signup?plan=free">Start free</Link></div>
            <div className="plan hl"><h3>Pro</h3><div className="price">{formatMoney(P.proMonthly, currency)}<small> / month</small></div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--mut)' }}>or {formatMoney(P.proAnnual, currency)} billed yearly</p>
              <ul><li>Everything in Free</li><li>Higher limits for AI search and imports</li><li>Connect Claude and Cursor</li><li>Weekly digest and Friday After-Hours</li><li>{TRIAL_MONTHS} months free to start</li></ul>
              <Link className="btn p" href={CLAIM}>Claim {TRIAL_MONTHS} months free</Link></div>
          </div>
        </section>

        <section id="faq" className="sec">
          <h2>Questions, answered</h2>
          <div className="faq">{FAQS.map((f) => <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>)}</div>
        </section>

        <section className="band">
          <h2>Your future self will thank you</h2>
          <p>Save it once. Find it by meaning.</p>
          <div className="cta"><Link className="btn p" href={CLAIM}>Get Started Free</Link></div>
        </section>

        <footer>
          <span>© {new Date().getFullYear()} Bukmarkz. All rights reserved.</span>
          <nav aria-label="Footer"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/login">Sign in</Link></nav>
        </footer>
      </div>
    </div>
  );
}
