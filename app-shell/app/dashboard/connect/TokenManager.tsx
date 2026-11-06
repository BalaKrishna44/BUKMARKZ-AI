'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Note, Panel, btn, btnGhost, input } from '@/components/shell/ui';

interface Tok { id: string; name: string; prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null }
interface Info { tier: string; usage: { used: number; limit: number }; tokens: Tok[] }
const JSON_HEADERS = { 'content-type': 'application/json' };

export default function TokenManager() {
  const [info, setInfo] = useState<Info | null>(null), [name, setName] = useState(''), [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null), [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  const load = useCallback(async () => {
    const r = await fetch('/api/mcp/tokens', { cache: 'no-store' });
    if (r.ok) setInfo(await r.json() as Info); else setMsg({ tone: 'err', text: 'Could not load your tokens. Refresh the page.' });
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault(); if (busy || !name.trim()) return; setBusy(true); setMsg(null);
    const r = await fetch('/api/mcp/tokens', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name }) });
    const j = await r.json().catch(() => ({})) as { token?: string; message?: string };
    setBusy(false);
    if (!r.ok || !j.token) { setMsg({ tone: 'err', text: j.message ?? 'Could not create the token.' }); return; }
    setFresh(j.token); setName(''); void load();
  }
  async function revoke(id: string) {
    if (!window.confirm('Revoke this token? Any tool using it stops working.')) return;
    const r = await fetch('/api/mcp/tokens', { method: 'DELETE', headers: JSON_HEADERS, body: JSON.stringify({ id }) });
    if (r.ok) void load(); else setMsg({ tone: 'err', text: 'Could not revoke. Try again.' });
  }
  async function copy(t: string) { try { await navigator.clipboard.writeText(t); setMsg({ tone: 'ok', text: 'Copied.' }); } catch { setMsg({ tone: 'err', text: 'Copy is blocked here. Select the text and copy it by hand.' }); } }

  const cursor = JSON.stringify({ mcpServers: { bukmarkz: { url: `${origin}/api/mcp`, headers: { Authorization: `Bearer ${fresh ?? 'YOUR_TOKEN'}` } } } }, null, 2);
  const claude = JSON.stringify({ mcpServers: { bukmarkz: { command: 'npx', args: ['-y', 'mcp-remote', `${origin}/api/mcp`, '--header', `Authorization: Bearer ${fresh ?? 'YOUR_TOKEN'}`] } } }, null, 2);
  const active = (info?.tokens ?? []).filter((t) => !t.revoked_at);

  return (
    <>
      {msg && <Note tone={msg.tone}>{msg.text}</Note>}
      <Panel title="1. Create a token">
        <form onSubmit={(e) => void create(e)} className="flex flex-wrap gap-2">
          <input className={`${input} max-w-xs`} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cursor on my laptop" maxLength={60} aria-label="Token name" />
          <button className={btn} disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create token'}</button>
        </form>
        {fresh && (
          <div className="mt-3 rounded-xl border border-[#f4a52a]/50 bg-[#fff8ea] p-3">
            <p className="text-sm font-semibold text-[#10261c]">Copy your token now. It is shown only once.</p>
            <code className="mt-1 block break-all rounded bg-white px-2 py-1.5 text-xs text-[#10261c]">{fresh}</code>
            <div className="mt-2 flex gap-2"><button className={btnGhost} onClick={() => void copy(fresh)}>Copy token</button><button className={btnGhost} onClick={() => setFresh(null)}>I have saved it</button></div>
          </div>
        )}
        {info && <p className="mt-3 text-xs text-[#66766d]">Plan: {info.tier}. This month: {info.usage.used.toLocaleString('en-US')} of {info.usage.limit.toLocaleString('en-US')} AI-tool calls.</p>}
      </Panel>
      <Panel title="Your tokens">
        {active.length === 0 ? <p className="text-sm text-[#4b5c53]">No active tokens.</p> : (
          <ul className="divide-y divide-[#e6f3ea]">{active.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div><p className="font-medium text-[#10261c]">{t.name}</p><p className="text-xs text-[#66766d]">{t.prefix}… · created {new Date(t.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}{t.last_used_at ? ` · last used ${new Date(t.last_used_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ' · never used'}</p></div>
              <button className={btnGhost} onClick={() => void revoke(t.id)}>Revoke</button>
            </li>
          ))}</ul>
        )}
      </Panel>
      <Panel title="2. Add it to Cursor">
        <p className="mb-2 text-sm text-[#4b5c53]">Open Cursor settings, then MCP, and add this server (or paste it into <code className="rounded bg-[#eaf3ed] px-1">~/.cursor/mcp.json</code>).</p>
        <pre className="overflow-x-auto rounded-xl bg-[#0d2418] p-3 text-xs text-[#cfe6d8]">{cursor}</pre>
      </Panel>
      <Panel title="2. Or add it to Claude Desktop">
        <p className="mb-2 text-sm text-[#4b5c53]">Needs Node.js installed. Add this to <code className="rounded bg-[#eaf3ed] px-1">claude_desktop_config.json</code>, then restart Claude.</p>
        <pre className="overflow-x-auto rounded-xl bg-[#0d2418] p-3 text-xs text-[#cfe6d8]">{claude}</pre>
      </Panel>
    </>
  );
}
