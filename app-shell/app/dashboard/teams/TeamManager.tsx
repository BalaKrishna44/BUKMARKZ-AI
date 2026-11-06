'use client';

import { useState, type FormEvent } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Note, Panel, btn, btnGhost, input } from '@/components/shell/ui';

export interface OrgRow { id: string; name: string; slug: string; role: string }
interface Member { user_id: string; email: string | null; role: string; joined_at: string }
const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export default function TeamManager({ initial, defaultEmail }: { initial: OrgRow[]; defaultEmail: string }) {
  const [supabase] = useState(() => createClient());
  const [orgs, setOrgs] = useState(initial), [name, setName] = useState('');
  const [open, setOpen] = useState<string | null>(null), [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState(''), [role, setRole] = useState('viewer'), [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault(); if (busy || name.trim().length < 2) return; setBusy(true); setMsg(null);
    const slug = slugify(name) || `team-${Math.random().toString(36).slice(2, 7)}`;
    const { data, error } = await supabase.rpc('create_org', { p_name: name.trim(), p_slug: slug, p_billing_email: defaultEmail });
    setBusy(false);
    if (error) {
      const m = error.message ?? '';
      setMsg({ tone: 'err', text: m.includes('team_plan_required') ? 'Team workspaces need the Team plan.' : m.includes('org_limit_reached') ? 'You can own up to 3 workspaces.' : m.includes('duplicate') || error.code === '23505' ? 'That name is taken. Try another.' : 'Could not create the workspace.' });
      return;
    }
    const o = data as { id: string; name: string; slug: string };
    setOrgs((x) => [...x, { id: o.id, name: o.name, slug: o.slug, role: 'owner' }]); setName(''); setMsg({ tone: 'ok', text: 'Workspace created.' });
  }
  async function show(id: string) {
    if (open === id) { setOpen(null); return; }
    setOpen(id); setMembers([]);
    const { data, error } = await supabase.rpc('org_list_members', { p_org: id });
    if (error) { setMsg({ tone: 'err', text: 'Could not load members.' }); return; }
    setMembers((data ?? []) as Member[]);
  }
  async function add(e: FormEvent, orgId: string) {
    e.preventDefault(); if (busy || !email.trim()) return; setBusy(true); setMsg(null);
    const { error } = await supabase.rpc('org_add_member_by_email', { p_org: orgId, p_email: email.trim(), p_role: role });
    setBusy(false);
    if (error) { const m = error.message ?? ''; setMsg({ tone: 'err', text: m.includes('user_not_found') ? 'No Bukmarkz account uses that email yet. Ask them to sign up first.' : m.includes('forbidden') ? 'Only admins can add people.' : 'Could not add that person.' }); return; }
    setEmail(''); setMsg({ tone: 'ok', text: 'Added.' });
    const { data } = await supabase.rpc('org_list_members', { p_org: orgId }); setMembers((data ?? []) as Member[]);
  }
  return (
    <>
      {msg && <Note tone={msg.tone}>{msg.text}</Note>}
      <Panel title="Create a workspace">
        <form onSubmit={(e) => void create(e)} className="flex flex-wrap gap-2">
          <input className={`${input} max-w-xs`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Team name" maxLength={60} aria-label="Team name" />
          <button className={btn} disabled={busy || name.trim().length < 2}>Create</button>
        </form>
      </Panel>
      {orgs.length === 0 ? <Panel><p className="text-sm text-[#4b5c53]">You are not in a workspace yet.</p></Panel> : orgs.map((o) => (
        <Panel key={o.id}>
          <div className="flex items-center justify-between gap-3"><div><p className="font-bold text-[#10261c]">{o.name}</p><p className="text-xs text-[#66766d]">Your role: {o.role}</p></div><button className={btnGhost} onClick={() => void show(o.id)}>{open === o.id ? 'Hide' : 'Members'}</button></div>
          {open === o.id && (
            <div className="mt-3">
              <ul className="divide-y divide-[#e6f3ea]">{members.map((m) => <li key={m.user_id} className="flex justify-between py-2 text-sm"><span className="truncate text-[#10261c]">{m.email ?? 'Member'}</span><span className="text-[#66766d]">{m.role}</span></li>)}</ul>
              {['owner', 'admin'].includes(o.role) && (
                <form onSubmit={(e) => void add(e, o.id)} className="mt-3 flex flex-wrap gap-2">
                  <input className={`${input} max-w-xs`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" aria-label="Teammate email" />
                  <select className={`${input} w-auto`} value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role"><option value="viewer">Viewer</option><option value="editor">Editor</option><option value="admin">Admin</option></select>
                  <button className={btn} disabled={busy || !email.trim()}>Add</button>
                </form>
              )}
            </div>
          )}
        </Panel>
      ))}
    </>
  );
}
