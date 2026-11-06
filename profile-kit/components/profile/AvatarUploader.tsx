'use client';
import { useRef, useState } from 'react';
import Avatar from './Avatar';

const MAX = 2 * 1024 * 1024;
const ERR: Record<string, string> = {
  too_large: 'That file is over 2 MB.',
  unsupported_type: 'Please choose a JPEG, PNG or WebP image.',
  unreadable_image: 'That image could not be read. Try another one.',
  slow_down: 'Please wait a few seconds before changing it again.',
  unauthorized: 'Your session expired. Sign in again.',
  forbidden: 'This request was blocked. Reload the page and try again.',
};

export default function AvatarUploader({ initialUrl, name }: { initialUrl: string | null; name: string }) {
  const [url, setUrl] = useState(initialUrl);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX) return setMsg({ ok: false, text: ERR.too_large });
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData(); fd.append('file', file);
      const r = await fetch('/api/profile/avatar', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return setMsg({ ok: false, text: ERR[j.error as string] ?? 'Upload failed. Please try again.' });
      setUrl(j.url); setMsg({ ok: true, text: 'Profile picture updated.' });
    } catch { setMsg({ ok: false, text: 'Network error. Please try again.' }); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  }

  async function remove() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/profile/avatar', { method: 'DELETE' });
      if (!r.ok) return setMsg({ ok: false, text: 'Could not remove it. Please try again.' });
      setUrl(null); setMsg({ ok: true, text: 'Picture removed.' });
    } catch { setMsg({ ok: false, text: 'Network error. Please try again.' }); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex flex-wrap items-center gap-5">
      <Avatar url={url} name={name} size={96} />
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-60">
            {busy ? 'Working…' : 'Upload photo'}
          </button>
          {url && <button type="button" disabled={busy} onClick={remove} className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/5 disabled:opacity-60">Remove</button>}
        </div>
        <p className="text-xs text-slate-400">JPEG, PNG or WebP, up to 2 MB. We crop it to a square and remove location data.</p>
        <p role="status" aria-live="polite" className={`min-h-5 text-sm ${msg?.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{msg?.text}</p>
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => upload(e.target.files?.[0])} />
    </div>
  );
}
