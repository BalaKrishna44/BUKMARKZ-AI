'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface Note { id: string; notebook: string; title: string; body: string; pinned: boolean; updated_at: string }
type Save = 'saved' | 'saving' | 'error';

export default function NotesApp() {
  const supabase = useMemo(() => createClient(), []);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [notebook, setNotebook] = useState<string>('All');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [save, setSave] = useState<Save>('saved');
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from('notes').select('id,notebook,title,body,pinned,updated_at')
        .order('pinned', { ascending: false }).order('updated_at', { ascending: false }).limit(1000);
      if (error) setMissing(true);
      else { setNotes(data ?? []); setSel(data?.[0]?.id ?? null); }
      setLoaded(true);
    })();
  }, [supabase]);

  const notebooks = useMemo(() => Array.from(new Set(notes.map((n) => n.notebook))).sort(), [notes]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return notes.filter((n) => (notebook === 'All' || n.notebook === notebook) && (!s || n.title.toLowerCase().includes(s) || n.body.toLowerCase().includes(s)))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at));
  }, [notes, notebook, q]);
  const cur = notes.find((n) => n.id === sel) ?? null;

  const persist = useCallback((id: string, patch: Partial<Note>) => {
    setSave('saving');
    clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(async () => {
      const { error } = await supabase.from('notes').update(patch).eq('id', id);
      setSave(error ? 'error' : 'saved');
    }, 600);
  }, [supabase]);

  const edit = (patch: Partial<Note>) => {
    if (!cur) return;
    setNotes((all) => all.map((n) => (n.id === cur.id ? { ...n, ...patch, updated_at: new Date().toISOString() } : n)));
    persist(cur.id, patch);
  };

  const create = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const nb = notebook === 'All' ? 'General' : notebook;
    const { data, error } = await supabase.from('notes').insert({ user_id: user.id, notebook: nb, title: '', body: '' })
      .select('id,notebook,title,body,pinned,updated_at').single();
    if (error || !data) { setSave('error'); return; }
    setNotes((all) => [data, ...all]); setSel(data.id);
  };

  const remove = async () => {
    if (!cur || !window.confirm('Delete this note? This cannot be undone.')) return;
    const id = cur.id;
    clearTimeout(timers.current[id]);
    const { error } = await supabase.from('notes').delete().eq('id', id);
    if (error) { setSave('error'); return; }
    setNotes((all) => all.filter((n) => n.id !== id));
    setSel(shown.find((n) => n.id !== id)?.id ?? null);
  };

  const newNotebook = () => {
    const name = window.prompt('Notebook name')?.trim().slice(0, 60);
    if (name) setNotebook(name);
  };

  if (!loaded) return <main className="p-8 text-[#4b5c53]">Loading notes…</main>;
  if (missing) return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <h1 className="text-2xl font-extrabold text-[#10261c]">Notes needs one-time setup</h1>
      <p className="mt-2 text-[#4b5c53]">The notes table has not been created in the database yet. Run the migration <code>20260101000040_033_notes.sql</code> in the Supabase SQL editor, then reload this page.</p>
    </main>
  );

  const field = 'w-full rounded-lg border border-[#d8eedf] bg-white px-3 py-2 text-sm text-[#10261c] outline-none focus:border-[#2fa66a]';
  return (
    <main className="flex min-h-[calc(100vh-3rem)] flex-col lg:h-screen lg:flex-row">
      <aside className="shrink-0 border-b border-[#d8eedf] bg-white p-3 lg:w-48 lg:border-b-0 lg:border-r">
        <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-[#66766d]">Notebooks</p>
        <div className="flex gap-1 overflow-x-auto lg:flex-col">
          {['All', ...notebooks, ...(notebook !== 'All' && !notebooks.includes(notebook) ? [notebook] : [])].map((nb) => (
            <button key={nb} onClick={() => setNotebook(nb)} className={`shrink-0 truncate rounded-lg px-2.5 py-1.5 text-left text-sm font-medium ${notebook === nb ? 'bg-[#e6f6ec] text-[#10261c]' : 'text-[#33443b] hover:bg-[#f1f9f4]'}`}>{nb}</button>
          ))}
        </div>
        <button onClick={newNotebook} className="mt-2 w-full rounded-lg px-2.5 py-1.5 text-left text-sm font-semibold text-[#1a7f4e] hover:bg-[#f1f9f4]">+ New notebook</button>
      </aside>

      <section className="shrink-0 border-b border-[#d8eedf] bg-[#f8fcf9] p-3 lg:w-72 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes" aria-label="Search notes" className={field} />
          <button onClick={create} className="shrink-0 rounded-lg bg-[#2fa66a] px-3 text-sm font-semibold text-[#04230f] hover:bg-[#4fbf85]">New</button>
        </div>
        <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto lg:max-h-none">
          {shown.length === 0 && <li className="px-2 py-6 text-center text-sm text-[#66766d]">{notes.length === 0 ? 'No notes yet. Click New to write your first one.' : 'No matching notes'}</li>}
          {shown.map((n) => (
            <li key={n.id}><button onClick={() => setSel(n.id)} className={`block w-full rounded-lg px-3 py-2 text-left ${sel === n.id ? 'bg-[#e6f6ec]' : 'hover:bg-white'}`}>
              <span className="block truncate text-sm font-semibold text-[#10261c]">{n.pinned ? '📌 ' : ''}{n.title || 'Untitled'}</span>
              <span className="block truncate text-xs text-[#66766d]">{n.body.replace(/\s+/g, ' ').slice(0, 70) || 'Empty note'}</span>
              <span className="text-[11px] text-[#8a9a91]">{n.notebook} · {new Date(n.updated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
            </button></li>
          ))}
        </ul>
      </section>

      <section className="flex min-h-[28rem] flex-1 flex-col bg-white p-4 sm:p-6">
        {!cur ? <p className="m-auto text-[#66766d]">Select a note or create a new one.</p> : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <select value={cur.notebook} onChange={(e) => edit({ notebook: e.target.value })} aria-label="Notebook" className="rounded-lg border border-[#d8eedf] bg-white px-2 py-1.5 text-sm text-[#10261c]">
                {Array.from(new Set([...notebooks, cur.notebook])).map((nb) => <option key={nb}>{nb}</option>)}
              </select>
              <button onClick={() => edit({ pinned: !cur.pinned })} className="rounded-lg border border-[#d8eedf] px-2.5 py-1.5 text-sm font-medium text-[#33443b] hover:bg-[#f1f9f4]">{cur.pinned ? 'Unpin' : 'Pin'}</button>
              <button onClick={remove} className="rounded-lg border border-[#f0d4d4] px-2.5 py-1.5 text-sm font-medium text-[#b42318] hover:bg-[#fdf2f2]">Delete</button>
              <span className="ml-auto text-xs text-[#66766d]" aria-live="polite">{save === 'saving' ? 'Saving…' : save === 'error' ? 'Could not save, check your connection' : 'Saved'}</span>
            </div>
            <input value={cur.title} onChange={(e) => edit({ title: e.target.value.slice(0, 300) })} placeholder="Title" aria-label="Title" className="w-full border-0 border-b border-[#e6f3ea] pb-2 text-2xl font-extrabold tracking-tight text-[#10261c] outline-none placeholder:text-[#b5c4bb]" />
            <textarea value={cur.body} onChange={(e) => edit({ body: e.target.value })} placeholder="Start writing…" aria-label="Note body" className="mt-3 w-full flex-1 resize-none border-0 text-[15px] leading-relaxed text-[#33443b] outline-none placeholder:text-[#b5c4bb]" />
          </>
        )}
      </section>
    </main>
  );
}
