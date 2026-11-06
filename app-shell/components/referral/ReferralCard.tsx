'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function ReferralCard() {
  const [link, setLink] = useState(''); const [copied, setCopied] = useState(false);
  useEffect(() => {
    createClient().rpc('get_or_create_referral_code').then(({ data }) => { if (typeof data === 'string') setLink(`${location.origin}/?ref=${data}`); });
  }, []);
  if (!link) return null;
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* select-and-copy fallback: the field is readOnly and selectable */ } };
  return (
    <section className="rounded-2xl border border-slate-700 p-4">
      <h2 className="font-semibold">Give a month of Pro, get a month of Pro</h2>
      <p className="mt-1 text-sm opacity-80">When a friend joins with your link and saves 5 links, you both get 30 days of Pro. Up to 12 friends.</p>
      <div className="mt-3 flex gap-2">
        <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-transparent px-3 py-2 text-sm" aria-label="Your referral link" />
        <button type="button" onClick={copy} className="rounded-lg bg-emerald-500 px-3 py-2 text-slate-950">{copied ? 'Copied' : 'Copy'}</button>
      </div>
    </section>
  );
}
