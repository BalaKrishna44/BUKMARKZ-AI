'use client';

import { useState, type FormEvent } from 'react';
import { createClient } from '@/lib/supabase/client';
import { startExtensionSync } from '@/lib/syncLoginToExtension';
import { useEffect } from 'react';

type Mode = 'password' | 'link';
export default function LoginForm({ next, linkFailed }: { next: string; linkFailed?: boolean }) {
  const [supabase] = useState(() => createClient());
  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(linkFailed ? { tone: 'err', text: 'That sign-in link expired or was already used. Request a new one.' } : null);
  useEffect(() => startExtensionSync(supabase), [supabase]);       // a login here reaches the extension straight away

  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return; setBusy(true); setMsg(null);
    if (mode === 'password') {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) { setBusy(false); setMsg({ tone: 'err', text: 'Email or password is incorrect.' }); return; }   // one message for both: never reveal which accounts exist
      window.location.assign(next);                                     // full navigation so the server sees the new cookies
    } else {
      const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` } });
      setBusy(false);
      // same answer whether or not the address has an account
      setMsg(error && error.status !== 400 && error.status !== 422 ? { tone: 'err', text: 'Could not send the link. Try again in a minute.' } : { tone: 'ok', text: 'If that address has an account, a sign-in link is on its way.' });
    }
  }
  const field = 'mt-1.5 h-11 w-full rounded-xl border border-[#d8eedf] bg-white px-3.5 text-[15px] text-[#10261c] outline-none placeholder:text-[#66766d] focus:border-[#2fa66a] focus:ring-2 focus:ring-[#2fa66a]/30';
  return (
    <main className="grid min-h-screen place-items-center bg-[#f1f9f4] px-4 py-10 text-[#33443b]">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5"><span aria-hidden="true" className="grid size-9 place-items-center rounded-lg bg-[#2fa66a] text-[#04230f]"><svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" /></svg></span><span className="text-lg font-bold tracking-tight text-[#10261c]">Bukmarkz</span></div>
        <form onSubmit={(e) => void submit(e)} className="rounded-2xl border border-[#d8eedf] bg-white p-6 shadow-sm">
          <h1 className="text-xl font-bold tracking-tight text-[#10261c]">Welcome back</h1>
          <p className="mt-1 text-sm text-[#4b5c53]">Sign in to open your second brain.</p>
          <label className="mt-5 block text-sm font-medium text-[#10261c]" htmlFor="email">Email</label>
          <input id="email" type="email" required autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} placeholder="you@example.com" />
          {mode === 'password' && (<>
            <label className="mt-4 block text-sm font-medium text-[#10261c]" htmlFor="password">Password</label>
            <input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
          </>)}
          {msg && <p role={msg.tone === 'err' ? 'alert' : 'status'} className={`mt-4 rounded-lg px-3 py-2 text-sm ${msg.tone === 'err' ? 'bg-rose-50 text-rose-800' : 'bg-[#eaf3ed] text-[#1a7f4e]'}`}>{msg.text}</p>}
          <button type="submit" disabled={busy} className="mt-5 h-11 w-full rounded-xl bg-[#2fa66a] text-[15px] font-semibold text-[#04230f] outline-none hover:bg-[#4fbf85] focus-visible:ring-2 focus-visible:ring-[#2fa66a] focus-visible:ring-offset-2 disabled:opacity-60">
            {busy ? 'One moment…' : mode === 'password' ? 'Sign in' : 'Email me a sign-in link'}
          </button>
          <button type="button" onClick={() => { setMode(mode === 'password' ? 'link' : 'password'); setMsg(null); }} className="mt-3 w-full rounded-lg py-2 text-sm font-medium text-[#1a7f4e] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[#2fa66a]">
            {mode === 'password' ? 'Use an email link instead' : 'Use a password instead'}
          </button>
        </form>
      </div>
    </main>
  );
}
