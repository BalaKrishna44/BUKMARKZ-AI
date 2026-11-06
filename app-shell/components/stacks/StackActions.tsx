'use client';
import { useEffect, useRef, useState } from 'react';

type Viewer = { authed: boolean; own: boolean; following: boolean; follower_count: number };
type Props = { slug: string; followerCount: number; remixCount: number; accent: string; chip: string; ink: string };

const signIn = (slug: string) => `/login?next=${encodeURIComponent(`/s/${slug}`)}`;
const post = (url: string, method: 'POST' | 'DELETE', body: unknown) =>
  fetch(url, { method, headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });

/**
 * Follow + Remix buttons. The page around them is ISR-cached and identical for everyone, so the per-viewer part
 * (signed in? already following? own stack?) is fetched after mount. Signed-out visitors keep clear, working buttons that
 * send them to /login and straight back to this stack.
 */
export default function StackActions({ slug, followerCount, remixCount, accent, chip, ink }: Props) {
  const [v, setV] = useState<Viewer | null>(null);
  const [followers, setFollowers] = useState(followerCount);
  const [busy, setBusy] = useState<'follow' | 'remix' | null>(null);
  const [msg, setMsg] = useState('');
  const [needHandle, setNeedHandle] = useState(false);
  const [handle, setHandle] = useState('');
  const lock = useRef(false);                                      // a ref, not state: two fast clicks can't both pass

  useEffect(() => {
    let alive = true;
    fetch(`/api/stacks/follow?slug=${encodeURIComponent(slug)}`, { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Viewer | null) => { if (alive && j) { setV(j); setFollowers(j.follower_count); } })
      .catch(() => {});
    return () => { alive = false; };
  }, [slug]);

  async function run(kind: 'follow' | 'remix', fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(kind); setMsg('');
    try { await fn(); } catch { setMsg('Network problem. Please try again.'); } finally { lock.current = false; setBusy(null); }
  }

  const toggleFollow = () => run('follow', async () => {
    if (v && !v.authed) { window.location.href = signIn(slug); return; }
    const was = v?.following ?? false;
    const res = await post('/api/stacks/follow', was ? 'DELETE' : 'POST', { slug });
    if (res.status === 401) { window.location.href = signIn(slug); return; }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(j.message || 'Could not update. Please try again.'); return; }
    setV((p) => (p ? { ...p, following: !!j.following } : p)); setFollowers(j.follower_count ?? followers);
    setMsg(j.following ? 'Following. It’s saved to your account.' : 'Unfollowed.');
  });

  const remix = () => run('remix', async () => {
    if (v && !v.authed) { window.location.href = signIn(slug); return; }
    const res = await post('/api/stacks/remix', 'POST', handle ? { slug, handle: handle.trim().toLowerCase() } : { slug });
    if (res.status === 401) { window.location.href = signIn(slug); return; }
    const j = await res.json().catch(() => ({}));
    if (res.ok) { setMsg('Remix created. Taking you there…'); window.location.href = `/s/${j.slug}`; return; }
    if (j.error === 'handle_required' || j.error === 'handle_taken') setNeedHandle(true);
    setMsg(j.message || (j.issues?.[0]?.message as string) || 'Could not remix. Please try again.');
  });

  const btn = 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-60';
  const own = v?.own === true;

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-2">
        {!own && (
          <button type="button" onClick={toggleFollow} disabled={busy !== null} aria-pressed={v?.following ?? false}
            className={`${btn} border`} style={v?.following ? { background: accent, color: '#fff', borderColor: accent } : { background: chip, color: accent, borderColor: accent }}>
            <span aria-hidden>{v?.following ? '✓' : '+'}</span>{busy === 'follow' ? 'Working…' : v?.following ? 'Following' : 'Follow Stack'}
          </button>
        )}
        {!own && (
          <button type="button" onClick={remix} disabled={busy !== null} className={`${btn} bg-[#2fa66a] text-white hover:bg-[#1a7f4e]`}>
            <span aria-hidden>⑂</span>{busy === 'remix' ? 'Remixing…' : 'Remix this Stack'}
          </button>
        )}
        {own && <span className="rounded-xl px-3 py-2 text-sm font-medium" style={{ background: chip, color: accent }}>This is your stack</span>}
        <span className="text-sm" style={{ color: ink, opacity: 0.8 }}>
          {followers.toLocaleString('en')} follower{followers === 1 ? '' : 's'}{remixCount > 0 && <> · {remixCount.toLocaleString('en')} remix{remixCount === 1 ? '' : 'es'}</>}
        </span>
      </div>

      {needHandle && (
        <form className="mt-3 flex max-w-sm flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); remix(); }}>
          <label className="flex-1 text-sm">
            <span className="mb-1 block font-medium">Pick your creator handle</span>
            <input value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} maxLength={20} minLength={3} required autoComplete="off" spellCheck={false}
              placeholder="e.g. ada_reads" className="w-full rounded-lg border border-black/20 bg-white px-3 py-2 text-[#10261c]" />
          </label>
          <button type="submit" disabled={busy !== null || handle.length < 3} className={`${btn} bg-[#2fa66a] text-white hover:bg-[#1a7f4e]`}>Remix</button>
        </form>
      )}
      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm">{msg}</p>
    </div>
  );
}
