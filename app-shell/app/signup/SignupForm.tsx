'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function SignupForm() {
  const [supabase] = useState(() => createClient());
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return;
    if (password.length < 8) { setMsg({ tone: 'err', text: 'Use at least 8 characters for the password.' }); return; }
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent('/dashboard/overview')}` } });
    setBusy(false);
    if (error) { setMsg({ tone: 'err', text: error.status === 429 ? 'Too many tries. Wait a few minutes and try again.' : 'We could not create that account. Check the details, or sign in if you already have one.' }); return; }
    if (data.session) { window.location.assign('/dashboard/overview'); return; }       // email confirmation is off: already signed in
    setMsg({ tone: 'ok', text: 'Check your email for a confirmation link to finish creating your account.' });   // same text whether or not the address already exists
  }
  const field = 'mt-1.5 h-11 w-full rounded-xl border border-[#d8eedf] bg-white px-3.5 text-[15px] text-[#10261c] outline-none placeholder:text-[#66766d] focus:border-[#2fa66a] focus:ring-2 focus:ring-[#2fa66a]/30';
  return (
    <main className="grid min-h-screen place-items-center bg-[#f1f9f4] px-4 py-10 text-[#33443b]">
      <form onSubmit={(e) => void submit(e)} className="w-full max-w-sm rounded-2xl border border-[#d8eedf] bg-white p-6 shadow-sm">
        <p className="text-lg font-bold tracking-tight text-[#10261c]">Bukmarkz</p>
        <h1 className="mt-4 text-xl font-bold tracking-tight text-[#10261c]">Create your account</h1>
        <p className="mt-1 text-sm text-[#4b5c53]">Save it once. Find it by meaning.</p>
        <label className="mt-5 block text-sm font-medium text-[#10261c]" htmlFor="email">Email</label>
        <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} placeholder="you@example.com" />
        <label className="mt-4 block text-sm font-medium text-[#10261c]" htmlFor="password">Password</label>
        <input id="password" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
        {msg && <p role={msg.tone === 'err' ? 'alert' : 'status'} className={`mt-4 rounded-lg px-3 py-2 text-sm ${msg.tone === 'err' ? 'bg-rose-50 text-rose-800' : 'bg-[#eaf3ed] text-[#1a7f4e]'}`}>{msg.text}</p>}
        <button type="submit" disabled={busy} className="mt-5 h-11 w-full rounded-xl bg-[#2fa66a] text-[15px] font-semibold text-[#04230f] hover:bg-[#4fbf85] disabled:opacity-60">{busy ? 'One moment…' : 'Create account'}</button>
        <p className="mt-4 text-center text-sm text-[#4b5c53]">Already have an account? <Link href="/login" className="font-semibold text-[#1a7f4e] hover:underline">Sign in</Link></p>
        <p className="mt-3 text-center text-xs text-[#66766d]">By signing up you agree to the <Link href="/terms" className="underline">Terms</Link> and <Link href="/privacy" className="underline">Privacy Policy</Link>.</p>
      </form>
    </main>
  );
}
