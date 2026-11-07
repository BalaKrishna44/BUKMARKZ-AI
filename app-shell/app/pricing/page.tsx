import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies, headers } from 'next/headers';
import PublicShell from '@/components/landing/PublicShell';
import { CURRENCY_COOKIE, PRICES, detectCurrency, formatMoney } from '@/lib/currency';
import { TRIAL_MONTHS } from '@/lib/site-data';

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Bukmarkz pricing: a free plan, and Pro with 6 months free to start. No credit card needed.',
  alternates: { canonical: '/pricing' },
};

export default async function Pricing() {
  const [h, c] = await Promise.all([headers(), cookies()]);
  const currency = detectCurrency({ cookie: c.get(CURRENCY_COOKIE)?.value, country: h.get('x-vercel-ip-country') ?? h.get('cf-ipcountry') });
  const P = PRICES[currency];
  return (
    <PublicShell>
      <section className="sec">
        <h1 style={{ fontSize: 'clamp(30px,5vw,46px)', margin: 0 }}>Start with {TRIAL_MONTHS} months of Pro, free</h1>
        <p className="lead">No credit card needed to start.</p>
        <div className="plans">
          <div className="plan"><h3>Free</h3><div className="price">{formatMoney(0, currency)}<small> / month</small></div>
            <ul><li>Save links and notes</li><li>Find them by meaning with AI search</li><li>Chrome extension</li><li>Private saves stay on your device</li></ul>
            <Link className="btn o" href="/signup?plan=free">Start free</Link></div>
          <div className="plan hl"><h3>Pro</h3><div className="price">{formatMoney(P.proMonthly, currency)}<small> / month</small></div>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--mut)' }}>or {formatMoney(P.proAnnual, currency)} billed yearly</p>
            <ul><li>Everything in Free</li><li>Higher limits for AI search and imports</li><li>Connect Claude and Cursor</li><li>Weekly digest and Friday After-Hours</li><li>{TRIAL_MONTHS} months free to start</li></ul>
            <Link className="btn p" href="/signup?plan=pro-trial">Claim {TRIAL_MONTHS} months free</Link></div>
        </div>
      </section>
    </PublicShell>
  );
}
