'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Note, Panel } from './ui';

/** One on/off switch backed by a Postgres function (set_digest_enabled / set_friday_enabled). */
export default function PrefToggle({ label, rpc, initial, detail, withTimezone }: { label: string; rpc: 'set_digest_enabled' | 'set_friday_enabled'; initial: boolean; detail?: string; withTimezone?: boolean }) {
  const [supabase] = useState(() => createClient());
  const [on, setOn] = useState(initial), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  async function flip() {
    if (busy) return; setBusy(true); setErr('');
    const next = !on;
    const args = withTimezone ? { p_on: next, p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } : { p_on: next };
    const { error } = await supabase.rpc(rpc, args);
    setBusy(false);
    if (error) { setErr('Could not save that. Try again in a moment.'); return; }
    setOn(next);
  }
  return (
    <Panel>
      <div className="flex items-center justify-between gap-4">
        <div><p className="font-semibold text-[#10261c]">{label}</p>{detail && <p className="text-sm text-[#4b5c53]">{detail}</p>}</div>
        <button role="switch" aria-checked={on} aria-label={label} onClick={() => void flip()} disabled={busy}
          className={`relative h-7 w-12 shrink-0 rounded-full outline-none transition focus-visible:ring-2 focus-visible:ring-[#2fa66a] focus-visible:ring-offset-2 disabled:opacity-60 ${on ? 'bg-[#2fa66a]' : 'bg-[#c3d6c9]'}`}>
          <span className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>
      {err && <div className="mt-3"><Note tone="err">{err}</Note></div>}
    </Panel>
  );
}
