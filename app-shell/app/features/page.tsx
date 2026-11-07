import type { Metadata } from 'next';
import Link from 'next/link';
import PublicShell from '@/components/landing/PublicShell';
import { FEATURES } from '@/components/landing/data';

export const metadata: Metadata = {
  title: 'Features',
  description: 'Everything Bukmarkz does: ask your bookmarks by meaning, auto-filing, instant import, session flush, weekly digest, Claude and Cursor integration, shareable stacks and team spaces.',
  alternates: { canonical: '/features' },
};

export default function Features() {
  return (
    <PublicShell>
      <section className="sec">
        <h1 style={{ fontSize: 'clamp(30px,5vw,46px)', margin: 0 }}>Features</h1>
        <p className="lead">Everything your bookmarks were supposed to do, with one rule behind all of it: private means private.</p>
        <div className="grid">{FEATURES.map(([t, d]) => <div key={t} className="card"><b>{t}</b><span>{d}</span></div>)}</div>
        <div className="note"><b>Private stays private.</b> Items you mark private are never put in stacks, digests, team spaces, shared sessions or AI answers.</div>
        <div className="cta" style={{ marginTop: 28 }}><Link className="btn p" href="/signup?plan=pro-trial">Get Started Free</Link></div>
      </section>
    </PublicShell>
  );
}
