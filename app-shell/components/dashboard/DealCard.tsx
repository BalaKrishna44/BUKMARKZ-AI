'use client';

import { useState, type ReactNode } from 'react';
import { buildShare, dropPercent, money } from '@/lib/deals/share';

export interface DealCardProps {
  title: string;
  url: string;                    // the saved product URL, untouched
  host: string;                   // "amazon.in"
  currentPrice: number;
  originalPrice: number;          // what to compare against: the 90-day median, or the price when it was saved
  currency: string;               // ISO 4217
  seenAt?: string | null;         // ISO time of the last check
  refCode?: string | null;        // the viewer's referral code (get_or_create_referral_code); omit to share without an invite line
  buy?: ReactNode;                // pass <BuyButton .../> from a Server Component: it is the only place an affiliate tag may be added, with its disclosure
}

/** A price-drop card with one-tap sharing. Clipboard and share links are best-effort and never throw into the page. */
export function DealCard({ title, url, host, currentPrice, originalPrice, currency, seenAt, refCode, buy }: DealCardProps) {
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const pct = dropPercent(currentPrice, originalPrice);
  const share = buildShare({ title, url, price: currentPrice, was: originalPrice, currency, refCode });

  async function copy() {
    if (!share) return;
    try { await navigator.clipboard.writeText(share.text); setCopied('ok'); }
    catch {
      try {                                                   // older webviews refuse the async clipboard API
        const t = document.createElement('textarea'); t.value = share.text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
        document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); document.body.removeChild(t); setCopied(ok ? 'ok' : 'fail');
      } catch { setCopied('fail'); }
    }
    setTimeout(() => setCopied(null), 2200);
  }

  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-md" aria-label={`Price drop: ${title}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs text-slate-500">{host}</p>
          <h3 className="mt-0.5 line-clamp-2 text-balance font-semibold text-slate-100">{title}</h3>
        </div>
        {pct >= 1
          ? <span className="shrink-0 rounded-full bg-emerald-400 px-2.5 py-1 text-sm font-bold text-slate-950" aria-label={`${pct} percent cheaper`}>−{pct}%</span>
          : <span className="shrink-0 rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-400">No drop yet</span>}
      </div>

      <p className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-3xl font-bold tracking-tight text-emerald-300">{money(currentPrice, currency)}</span>
        {pct >= 1 && <span className="text-sm text-slate-500 line-through" aria-label={`was ${money(originalPrice, currency)}`}>{money(originalPrice, currency)}</span>}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Reported price{seenAt ? <> · checked <time dateTime={seenAt}>{new Date(seenAt).toLocaleDateString('en', { month: 'short', day: 'numeric' })}</time></> : null}. Confirm it at the store before you buy.
      </p>

      <div className="mt-4 flex flex-wrap items-start gap-2">
        {buy}
        {share ? (
          <>
            <a href={share.whatsapp} target="_blank" rel="noopener noreferrer"
              className="rounded-lg border border-slate-700 bg-slate-800/70 px-3.5 py-2 text-sm font-medium text-slate-100 hover:border-emerald-400/50 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300">Share via WhatsApp</a>
            <a href={share.telegram} target="_blank" rel="noopener noreferrer"
              className="rounded-lg border border-slate-700 bg-slate-800/70 px-3.5 py-2 text-sm font-medium text-slate-100 hover:border-emerald-400/50 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300">Telegram</a>
            <button type="button" onClick={copy}
              className="rounded-lg border border-slate-700 bg-slate-800/70 px-3.5 py-2 text-sm font-medium text-slate-100 hover:border-emerald-400/50 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300">
              {copied === 'ok' ? 'Copied ✓' : copied === 'fail' ? 'Copy failed' : 'Copy deal link'}
            </button>
          </>
        ) : null}
      </div>
      <span role="status" className="sr-only">{copied === 'ok' ? 'Deal copied to clipboard' : ''}</span>
      {share?.invite && <p className="mt-3 text-[11px] text-slate-500">Shared messages include your Bukmarkz invite link. The product link is sent as-is, with no commission tag.</p>}
    </article>
  );
}
