'use client';
import { useState } from 'react';

const MSG: Record<string, string> = {
  reauth_required: 'For your security, please sign out, sign in again, and retry within 30 minutes.',
  confirmation_mismatch: 'The email or the word DELETE does not match.',
  org_owner_blocked: 'You are the only owner of a team that still has members. Transfer ownership or remove the members first.',
  files_failed: 'We could not remove all your files. Nothing was lost: please try again.',
  erase_failed: 'Something went wrong. Nothing was lost: please try again.',
  auth_delete_failed: 'Your data was removed but closing the login failed. Please press the button again.',
};

export default function DeleteAccount({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [typedEmail, setTypedEmail] = useState('');
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ready = word === 'DELETE' && typedEmail.trim().toLowerCase() === email.toLowerCase() && !busy;

  async function go() {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/account/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: word, email: typedEmail }) });
      if (r.ok) { window.location.href = '/?deleted=1'; return; }
      const j = await r.json().catch(() => ({}));
      setErr(MSG[j.error as string] ?? 'Something went wrong. Please try again.');
    } catch { setErr('Network error. Please try again.'); }
    setBusy(false);
  }

  return (
    <section className="rounded-3xl border border-red-500/30 bg-red-500/[0.05] p-6 sm:p-8">
      <h2 className="text-lg font-semibold text-white">Delete account</h2>
      <p className="mt-2 text-sm text-gray-300">Permanently erases your bookmarks, notes, tags, embeddings, archived pages, podcasts, profile picture and login. This cannot be undone.</p>
      {!open ? (
        <button onClick={() => setOpen(true)} className="mt-4 rounded-xl border border-red-400/50 px-4 py-2 text-sm font-medium text-red-300 hover:bg-red-500/10">Delete my account…</button>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); if (ready) void go(); }} className="mt-4 space-y-3">
          <label className="block text-sm text-gray-300">Type your email <b>{email}</b>
            <input value={typedEmail} onChange={(e) => setTypedEmail(e.target.value)} autoComplete="off" className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-white" /></label>
          <label className="block text-sm text-gray-300">Type <b>DELETE</b> to confirm
            <input value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-white" /></label>
          {err && <p role="alert" className="text-sm text-red-300">{err}</p>}
          <div className="flex gap-3">
            <button type="submit" disabled={!ready} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Deleting…' : 'Permanently delete'}</button>
            <button type="button" onClick={() => { setOpen(false); setErr(''); }} className="rounded-xl px-4 py-2 text-sm text-gray-300 hover:text-white">Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
