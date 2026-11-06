'use client';

import { useId, useState } from 'react';
import { Check, Gift, Minus, Users } from 'lucide-react';
import type { ComponentType, ReactNode, SVGProps } from 'react';
import { CURRENCIES, CURRENCY_NAME, PRICES, formatMoney, proPerMonthWhenAnnual, savePercent, type CurrencyCode } from './currency';

/* ------------------------------------------------------------------ data */

export type Billing = 'monthly' | 'annual';
export type PlanId = 'free' | 'pro' | 'team';

const TRIAL_MONTHS = 6;


/** true = included, false = not included, string = included with a limit or note. */
type Value = boolean | string;

interface Feature {
  label: string;
  free: Value;
  pro: Value;
  team: Value;
}

/**
 * Limits mirror PLAN_LIMITS in plan-gating/lib/planLimits.ts (the enforced numbers). `node pricing/check-limits.mjs` fails if they drift.
 * Team caps are placeholders in planLimits.ts as well: change both together.
 */
const FEATURES: Feature[] = [
  { label: 'Ask Your Vault (AI answers with sources)', free: '20 per month', pro: '1,000 per month', team: '1,500 per user / month' },
  { label: 'AI-indexed links (search + Ask)', free: 'Up to 300', pro: 'Up to 25,000', team: 'Up to 25,000' },
  { label: 'Vault MCP for Claude Desktop and Cursor', free: '50 calls / month, read-only', pro: '10,000 calls / month, read + save', team: '10,000 calls / month' },
  { label: 'Page snapshots (permanent copies)', free: false, pro: '500 per month', team: '1,000 per month' },
  { label: '1-click share sheet', free: true, pro: true, team: true },
  { label: 'WhatsApp and Telegram bot', free: false, pro: true, team: true },
];

/* ------------------------------------------------------------- component */

export interface PricingTableProps {
  defaultBilling?: Billing;
  /** Detected on the server with detectCurrency() (cookie, then country header, then USD). */
  currency?: CurrencyCode;
  /** Called when the visitor picks another currency; save it in the `bk_currency` cookie and re-render. */
  onCurrencyChange?: (c: CurrencyCode) => void;
  /** Called when a plan's button is pressed. Contact Sales opens `salesHref` instead. */
  onSelectPlan?: (plan: 'free' | 'pro', billing: Billing) => void;
  salesHref?: string;
}

export default function PricingTable({ defaultBilling = 'monthly', currency = 'USD', onCurrencyChange, onSelectPlan, salesHref = 'mailto:sales@bukmarkz.com?subject=Bukmarkz%20Team%20plan' }: PricingTableProps) {
  const [billing, setBilling] = useState<Billing>(defaultBilling);
  const annual = billing === 'annual';
  const switchId = useId();

  const P = PRICES[currency];
  const fmt = (n: number) => formatMoney(n, currency);
  const SAVE_PERCENT = savePercent(currency);
  const proPerMonth = annual ? proPerMonthWhenAnnual(currency) : P.proMonthly;

  return (
    <section aria-labelledby="pricing-title" className="relative isolate overflow-hidden bg-[#05070d] px-4 py-16 text-slate-100 sm:px-6 sm:py-24">
      {/* soft background glow */}
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-[#fca311]/10 blur-3xl" />

      <div className="mx-auto max-w-6xl">
        <header className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-[#fca311]">Pricing</p>
          <h2 id="pricing-title" className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-5xl">
            Start with {TRIAL_MONTHS} months of Pro, free
          </h2>
          <p className="mt-4 text-base text-slate-400 sm:text-lg">
            Bookmarks, rich notes, reminders and an AI inbox in one place. No credit card needed to start.
          </p>
        </header>

        {/* billing switch */}
        <div className="mt-10 flex items-center justify-center gap-3 text-sm">
          <span className={annual ? 'text-slate-400' : 'font-semibold text-white'}>Monthly</span>
          <button
            id={switchId}
            type="button"
            role="switch"
            aria-checked={annual}
            aria-label="Bill annually"
            onClick={() => setBilling(annual ? 'monthly' : 'annual')}
            className="relative h-7 w-12 shrink-0 rounded-full border border-slate-600 bg-slate-800 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fca311] aria-checked:border-[#fca311] aria-checked:bg-[#fca311]"
          >
            <span aria-hidden="true" className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full shadow transition-transform motion-reduce:transition-none ${annual ? 'translate-x-5 bg-[#14213d]' : 'bg-white'}`} />
          </button>
          <span className={annual ? 'font-semibold text-white' : 'text-slate-400'}>Annual</span>
          <span className="rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">Save {SAVE_PERCENT}%</span>
        </div>
        <div className="mt-4 flex justify-center">
          <label className="flex items-center gap-2 text-sm text-slate-400">
            <span>Currency</span>
            <select value={currency} onChange={(e) => onCurrencyChange?.(e.target.value as CurrencyCode)} className="rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-slate-100">
              {CURRENCIES.map((c) => <option key={c} value={c}>{CURRENCY_NAME[c]}</option>)}
            </select>
          </label>
        </div>

        <div className="mt-12 grid items-stretch gap-6 md:grid-cols-3 md:gap-5 lg:gap-8">
          {/* ---------------------------------------------------------- Free */}
          <PlanCard name="Free" blurb="For trying Bukmarkz and light everyday saving." plan="free">
            <Price amount={fmt(0)} unit="forever" />
            <p className="mt-1 min-h-[2.5rem] text-sm text-slate-400">&nbsp;</p>
            <Button variant="outline" onClick={() => onSelectPlan?.('free', billing)}>Get Started Free</Button>
            <FeatureList plan="free" />
          </PlanCard>

          {/* ------------------------------------------------------------ Pro */}
          <PlanCard name="Pro" blurb="Everything unlocked for people who live in their bookmarks." plan="pro" featured>
            <div className="absolute -top-4 left-1/2 -translate-x-1/2">
              <div className="relative">
                <span aria-hidden="true" className="absolute inset-0 rounded-full bg-[#fca311] opacity-60 blur-lg motion-safe:animate-pulse" />
                <span className="relative inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-gradient-to-r from-[#ffd27a] via-[#fca311] to-[#e08600] px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-[#14213d] shadow-[0_0_28px_-2px_rgba(252,163,17,0.8)]">
                  <Gift className="h-3.5 w-3.5" aria-hidden="true" />
                  {TRIAL_MONTHS} Months Free Trial
                </span>
              </div>
            </div>

            <div className="flex items-end gap-2">
              {annual && <span className="pb-1 text-lg text-slate-500 line-through" aria-label={`was ${fmt(P.proMonthly)} per month`}>{fmt(P.proMonthly)}</span>}
              <Price amount={fmt(proPerMonth)} unit="/ month" live />
            </div>
            <p className="mt-1 min-h-[2.5rem] text-sm text-slate-400" aria-live="polite">
              {annual ? `Billed ${fmt(P.proAnnual)} per year.` : 'Billed monthly.'}{' '}
              <span className="text-slate-300">Free for {TRIAL_MONTHS} months first, no card needed.</span>
            </p>
            <Button variant="primary" onClick={() => onSelectPlan?.('pro', billing)}>Claim {TRIAL_MONTHS} Months Free Pro</Button>
            <FeatureList plan="pro" />
          </PlanCard>

          {/* ----------------------------------------------------------- Team */}
          <PlanCard name="Team" blurb="Shared knowledge for teams that research together." plan="team" icon={Users}>
            <Price amount={fmt(P.teamMonthly)} unit="/ user / month" />
            <p className="mt-1 min-h-[2.5rem] text-sm text-slate-400">Annual and volume pricing available from sales.</p>
            <a
              href={salesHref}
              className="mt-2 block rounded-xl border border-slate-600 px-4 py-3 text-center text-sm font-semibold text-white transition-colors hover:border-slate-400 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fca311]"
            >
              Contact Sales
            </a>
            <FeatureList plan="team" />
          </PlanCard>
        </div>

        <p className="mt-10 text-center text-xs text-slate-500">Prices shown in {currency} and charged in {currency}. Pro billing starts only after your {TRIAL_MONTHS}-month free trial ends.</p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- pieces */

function PlanCard({ name, blurb, plan, featured = false, icon: Icon, children }: { name: string; blurb: string; plan: PlanId; featured?: boolean; icon?: ComponentType<SVGProps<SVGSVGElement>>; children: ReactNode }) {
  return (
    <article
      aria-labelledby={`plan-${plan}`}
      className={`relative flex flex-col rounded-2xl p-6 sm:p-7 ${
        featured
          ? 'order-first border-2 border-[#fca311] bg-gradient-to-b from-[#1a1409] via-[#0d0f18] to-[#0b1020] shadow-[0_0_60px_-12px_rgba(252,163,17,0.55)] md:order-none md:-my-4 md:pb-10 md:pt-10'
          : 'border border-slate-800 bg-[#0b1020]'
      }`}
    >
      <div className="flex items-center gap-2">
        <h3 id={`plan-${plan}`} className="text-xl font-bold text-white">{name}</h3>
        {Icon && <Icon className="h-4 w-4 text-slate-400" aria-hidden="true" />}
      </div>
      <p className="mt-1 min-h-[2.5rem] text-sm text-slate-400">{blurb}</p>
      <div className="mt-5 flex flex-1 flex-col">{children}</div>
    </article>
  );
}

function Price({ amount, unit, live = false }: { amount: string; unit: string; live?: boolean }) {
  return (
    <p className="flex items-baseline gap-1.5" aria-live={live ? 'polite' : undefined}>
      <span className="text-4xl font-bold tracking-tight text-white sm:text-5xl">{amount}</span>
      <span className="text-sm text-slate-400">{unit}</span>
    </p>
  );
}

function Button({ variant, onClick, children }: { variant: 'primary' | 'outline'; onClick: () => void; children: ReactNode }) {
  const base = 'mt-2 block w-full rounded-xl px-4 py-3 text-center text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fca311]';
  return (
    <button
      type="button"
      onClick={onClick}
      className={variant === 'primary' ? `${base} bg-[#fca311] font-bold text-[#14213d] shadow-[0_8px_30px_-8px_rgba(252,163,17,0.8)] hover:bg-[#ffb23e]` : `${base} border border-slate-600 text-white hover:border-slate-400 hover:bg-slate-800`}
    >
      {children}
    </button>
  );
}

function FeatureList({ plan }: { plan: PlanId }) {
  return (
    <ul className="mt-6 space-y-3 border-t border-slate-800 pt-6 text-sm">
      {FEATURES.map((f) => {
        const v = f[plan];
        const on = v !== false;
        return (
          <li key={f.label} className="flex items-start gap-3">
            {on ? (
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#fca311]" aria-hidden="true" />
            ) : (
              <Minus className="mt-0.5 h-4 w-4 shrink-0 text-slate-600" aria-hidden="true" />
            )}
            <span className={on ? 'text-slate-200' : 'text-slate-500'}>
              {f.label}
              {typeof v === 'string' && <span className="text-slate-400">: {v}</span>}
              <span className="sr-only">{on ? ' (included)' : ' (not included)'}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
