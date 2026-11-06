'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Msg = { ok: boolean; text: string; upgrade?: string } | null;
const REASONS: Record<string, string> = { 'invalid-url': 'That doesn’t look like a web address.', 'unsupported-scheme': 'Only http and https links can be saved.', 'credentials-in-url': 'Links with a password in them can’t be saved.', 'missing-url': 'Paste a link first.', 'url-too-long': 'That link is too long.' };

export default function SaveForm({ initialUrl, initialTitle, sharedButInvalid }: { initialUrl: string; initialTitle: string; sharedButInvalid: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl); const [title, setTitle] = useState(initialTitle); const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(sharedButInvalid ? { ok: false, text: 'We couldn’t find a web link in what was shared. Paste it below.' } : null);

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (busy) return; setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url, title, note }) });
      const j = await r.json().catch(() => ({} as Record<string, unknown>));
      if (r.status === 401) { window.location.assign('/login?next=/m/save'); return; }
      if (r.status === 402) { const up = typeof j.upgradeUrl === 'string' && j.upgradeUrl.startsWith('/') ? j.upgradeUrl : '/pricing'; setMsg({ ok: false, text: String(j.message ?? 'You’ve reached your plan limit.'), upgrade: up }); return; }
      if (r.status === 422) { setMsg({ ok: false, text: REASONS[String(j.reason)] ?? 'That link can’t be saved.' }); return; }
      if (!r.ok) { setMsg({ ok: false, text: 'Couldn’t save right now. Please try again.' }); return; }
      setMsg({ ok: true, text: j.alreadySaved ? 'Already in your library.' : 'Saved. Buk is organizing it.' });
      setTimeout(() => { router.replace('/m'); router.refresh(); }, 900);
    } catch { setMsg({ ok: false, text: 'No connection. Please try again.' }); }
    finally { setBusy(false); }
  }

  const field = 'w-full rounded-xl border border-[#d6e8dc] bg-white px-3.5 py-3 text-[15px] outline-none focus:ring-2 focus:ring-[#1a7f4e]';
  return (
    <form onSubmit={save} className="space-y-3" noValidate>
      <label className="block text-sm font-medium">Link<input value={url} onChange={e => setUrl(e.target.value)} type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" placeholder="https://…" required className={`${field} mt-1`} /></label>
      <label className="block text-sm font-medium">Title <span className="font-normal text-[#5b7266]">(optional)</span><input value={title} onChange={e => setTitle(e.target.value)} maxLength={300} className={`${field} mt-1`} /></label>
      <label className="block text-sm font-medium">Note <span className="font-normal text-[#5b7266]">(optional)</span><textarea value={note} onChange={e => setNote(e.target.value)} maxLength={2000} rows={3} className={`${field} mt-1`} /></label>
      <button disabled={busy || !url.trim()} className="w-full rounded-xl bg-[#1a7f4e] px-4 py-3 font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
      {msg && (
        <p role="status" className={`text-sm ${msg.ok ? 'text-[#0f5c36]' : 'text-[#b42318]'}`}>
          {msg.text} {msg.upgrade && <a href={msg.upgrade} className="font-semibold underline">See plans</a>}
        </p>)}
    </form>
  );
}
