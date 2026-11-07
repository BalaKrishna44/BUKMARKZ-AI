import type { Metadata } from 'next';
import Link from 'next/link';
import PublicShell from '@/components/landing/PublicShell';

export const metadata: Metadata = {
  title: 'Download the Chrome extension',
  description: 'Save any page to Bukmarkz in one click with the Chrome extension. Works on Chrome, Edge and Firefox.',
  alternates: { canonical: '/download' },
};

export default function Download() {
  return (
    <PublicShell>
      <section className="sec">
        <h1 style={{ fontSize: 'clamp(30px,5vw,46px)', margin: 0 }}>Download the Bukmarkz extension</h1>
        <p className="lead">Save any page in one click. Bukmarkz files it for you and you find it later by meaning.</p>
        <div className="grid">
          <div className="card"><b>1. Create your free account</b><span>Sign up in under a minute. No credit card needed.</span></div>
          <div className="card"><b>2. Get the extension</b><span>Your account has a download page with the extension for Chrome, Edge and Firefox, plus step-by-step install instructions.</span></div>
          <div className="card"><b>3. Save and ask</b><span>Click the toolbar button to save, then ask your vault questions from the dashboard.</span></div>
        </div>
        <div className="cta" style={{ marginTop: 28 }}><Link className="btn p" href="/signup?plan=pro-trial">Create account</Link><Link className="btn o" href="/login?next=/dashboard/extension">I already have an account</Link></div>
      </section>
    </PublicShell>
  );
}
