'use client';
import { useEffect, useState } from 'react';
import { disablePush, enablePush, getPushState, type PushState } from '@/lib/push-client';

const MSG: Record<string, string> = {
  too_many_devices: 'You already have alerts on 10 devices. Turn one off first.',
  missing_vapid_key: 'Push is not configured yet.',
  subscribe_failed: 'Could not turn on alerts. Try again.',
};

export function EnablePushButton() {
  const [state, setState] = useState<PushState | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { getPushState().then(setState).catch(() => setState('unsupported')); }, []);

  async function toggle() {
    setBusy(true); setErr('');
    try {
      setState(state === 'on' ? await disablePush() : await enablePush(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''));
    } catch (e) { setErr(MSG[(e as Error).message] ?? MSG.subscribe_failed); }
    finally { setBusy(false); }
  }

  if (state === 'loading' || state === 'unsupported') return null;
  if (state === 'ios-needs-install') return <p className="text-sm opacity-80">On iPhone, tap Share → Add to Home Screen, then open Bukmarkz from your Home Screen to turn on price alerts.</p>;
  if (state === 'denied') return <p className="text-sm opacity-80">Notifications are blocked for Bukmarkz. Allow them in your browser or phone settings, then come back.</p>;

  return (
    <div className="space-y-2">
      <button type="button" onClick={toggle} disabled={busy} aria-pressed={state === 'on'}
        className="rounded-lg bg-emerald-500 px-4 py-2 text-slate-950 disabled:opacity-60">
        {busy ? 'Working…' : state === 'on' ? 'Turn off price alerts on this device' : 'Turn on price alerts on this device'}
      </button>
      {err && <p role="alert" className="text-sm text-red-400">{err}</p>}
    </div>
  );
}
