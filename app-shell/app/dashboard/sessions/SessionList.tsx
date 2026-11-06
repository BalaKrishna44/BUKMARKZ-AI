'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Note, Panel, btnGhost } from '@/components/shell/ui';

export interface SessionRow { id: string; title: string; summary: string | null; tab_count: number; shared: boolean; created_at: string }

export default function SessionList({ initial }: { initial: SessionRow[] }) {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState(initial);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const link = (id: string) => `${window.location.origin}/s/${id}`;

  async function copy(id: string) {
    try { await navigator.clipboard.writeText(link(id)); setMsg({ tone: 'ok', text: 'Link copied.' }); } catch { setMsg({ tone: 'ok', text: link(id) }); }
  }
  async function toggle(r: SessionRow) {
    const { error } = await supabase.from('sessions').update({ shared: !r.shared }).eq('id', r.id);
    if (error) { setMsg({ tone: 'err', text: 'Could not change sharing. Try again.' }); return; }
    setRows((x) => x.map((y) => (y.id === r.id ? { ...y, shared: !r.shared } : y)));
  }
  async function remove(r: SessionRow) {
    if (!window.confirm(`Delete “${r.title}”? This cannot be undone.`)) return;
    const { error } = await supabase.from('sessions').delete().eq('id', r.id);
    if (error) { setMsg({ tone: 'err', text: 'Could not delete. Try again.' }); return; }
    setRows((x) => x.filter((y) => y.id !== r.id));
  }
  return (
    <>
      {msg && <Note tone={msg.tone}>{msg.text}</Note>}
      {rows.map((r) => (
        <Panel key={r.id}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><h2 className="truncate text-base font-bold text-[#10261c]">{r.title}</h2>
              <p className="text-xs text-[#66766d]">{r.tab_count} tabs · {new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · {r.shared ? 'Shared by link' : 'Private'}</p>
              {r.summary && <p className="mt-2 text-sm text-[#4b5c53]">{r.summary}</p>}</div>
            <div className="flex flex-wrap gap-2">
              {r.shared && <><a href={link(r.id)} target="_blank" rel="noopener noreferrer" className={btnGhost}>Open</a><button className={btnGhost} onClick={() => void copy(r.id)}>Copy link</button></>}
              <button className={btnGhost} onClick={() => void toggle(r)}>{r.shared ? 'Make private' : 'Share'}</button>
              <button className={btnGhost} onClick={() => void remove(r)}>Delete</button>
            </div>
          </div>
        </Panel>
      ))}
    </>
  );
}
