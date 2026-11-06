'use client';
import { BookMarked, Check, ChevronDown, Copy, Download, ExternalLink, Link2, Loader2, Pencil, Quote, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface Highlight { id: string; source_url: string; url_key: string; source_title: string | null; quote: string; note: string | null; created_at: string; fragmentUrl: string }
interface Meta { url_key: string; title: string | null; authors: string[]; published: string | null; container: string | null; publisher: string | null; doi: string | null; edited: boolean }
type Fmt = 'bibtex' | 'apa' | 'csl' | 'md';
const FORMATS: { id: Fmt; label: string; file: string; type: string }[] = [
  { id: 'bibtex', label: 'BibTeX', file: 'bukmarkz-bibliography.bib', type: 'application/x-bibtex' },
  { id: 'apa', label: 'APA 7', file: 'bukmarkz-bibliography.txt', type: 'text/plain' },
  { id: 'csl', label: 'CSL-JSON', file: 'bukmarkz-bibliography.json', type: 'application/json' },
  { id: 'md', label: 'Notes (Markdown)', file: 'bukmarkz-notes.md', type: 'text/markdown' },
];
const glass = 'border border-white/10 bg-white/[.06] backdrop-blur-xl';
const btn = 'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300 disabled:opacity-50';
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const safeHref = (u: string) => (/^https?:\/\//i.test(u) ? u : '#');          // stored data is never trusted to be a safe href

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  try { const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch { return false; }
}
const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };

export default function HighlightLibrary() {
  const [items, setItems] = useState<Highlight[]>([]);
  const [meta, setMeta] = useState<Record<string, Meta>>({});
  const [next, setNext] = useState<string | null>(null);
  const [q, setQ] = useState(''), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [out, setOut] = useState<{ fmt: Fmt; text: string } | null>(null), [exporting, setExporting] = useState(false), [menu, setMenu] = useState(false);
  const [flash, setFlash] = useState(''), [editing, setEditing] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async (reset: boolean, before?: string | null) => {
    const my = ++seq.current; setLoading(true); setError('');
    const p = new URLSearchParams({ limit: '30' }); if (q.trim()) p.set('q', q.trim()); if (before) p.set('before', before);
    try {
      const r = await fetch(`/api/highlights?${p}`, { headers: { Accept: 'application/json' } });
      if (r.status === 401) { window.location.href = '/login?next=%2Fdashboard%2Fhighlights'; return; }
      const j = await r.json();
      if (my !== seq.current) return;                                          // a newer search superseded this one
      if (!r.ok) throw new Error();
      setItems((prev) => (reset ? j.highlights : [...prev, ...j.highlights])); setMeta((prev) => ({ ...(reset ? {} : prev), ...j.meta })); setNext(j.next);
    } catch { if (my === seq.current) setError('Could not load your highlights. Try again.'); } finally { if (my === seq.current) setLoading(false); }
  }, [q]);
  useEffect(() => { const t = setTimeout(() => load(true), q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);

  const say = (m: string) => { setFlash(m); setTimeout(() => setFlash(''), 2000); };
  const groups = useMemo(() => { const g = new Map<string, Highlight[]>(); for (const h of items) g.set(h.url_key, [...(g.get(h.url_key) ?? []), h]); return [...g.entries()]; }, [items]);

  async function exportAs(fmt: Fmt) {
    setMenu(false); setExporting(true); setError('');
    const ids = [...sel];
    if (ids.length > 200) { setExporting(false); return setError('Select up to 200 highlights, or clear the selection to export everything.'); }
    try {
      const r = await fetch(`/api/cite/export?format=${fmt}&${ids.length ? `ids=${ids.join(',')}` : 'all=1'}`);
      if (!r.ok) throw new Error();
      setOut({ fmt, text: await r.text() });
    } catch { setError('Export failed. Try again.'); } finally { setExporting(false); }
  }
  function download() {
    if (!out) return;
    const f = FORMATS.find((x) => x.id === out.fmt)!;
    const url = URL.createObjectURL(new Blob([out.text], { type: `${f.type};charset=utf-8` }));
    const a = document.createElement('a'); a.href = url; a.download = f.file; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function remove(id: string) {
    const r = await fetch(`/api/highlights/${id}`, { method: 'DELETE', headers: JSON_HEADERS });
    if (r.ok) { setItems((p) => p.filter((h) => h.id !== id)); setSel((s) => { const n = new Set(s); n.delete(id); return n; }); } else setError('Could not delete that highlight.');
  }
  async function saveNote(id: string, note: string) {
    const r = await fetch(`/api/highlights/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ note: note.trim() || null }) });
    if (r.ok) setItems((p) => p.map((h) => (h.id === id ? { ...h, note: note.trim() || null } : h))); else setError('Could not save the note.');
  }
  async function saveMeta(h: Highlight, f: FormData) {
    const body = { url: h.source_url, title: String(f.get('title') ?? ''), authors: String(f.get('authors') ?? '').split('\n').map((s) => s.trim()).filter(Boolean), published: String(f.get('published') ?? ''), container: String(f.get('container') ?? ''), publisher: String(f.get('publisher') ?? ''), doi: String(f.get('doi') ?? '') };
    const r = await fetch('/api/cite/meta', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setError(j.message ?? 'Could not save the source details.');
    setEditing(null); say('Source details saved'); load(true);
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 text-slate-100">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><Quote className="h-7 w-7 text-emerald-400" aria-hidden /><div><h1 className="text-2xl font-bold tracking-tight">Highlights</h1><p className="text-sm text-slate-400">Passages you saved, each with a link that scrolls straight back to it.</p></div></div>
        <div className="relative">
          <button type="button" className={`${btn} ${glass} !px-3 !py-2`} onClick={() => setMenu((v) => !v)} aria-haspopup="menu" aria-expanded={menu} disabled={exporting || (!items.length && !loading)}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookMarked className="h-4 w-4" />}Export {sel.size ? `${sel.size} selected` : 'all'}<ChevronDown className="h-3.5 w-3.5" />
          </button>
          {menu && <div role="menu" className={`${glass} absolute right-0 z-10 mt-2 w-52 rounded-xl bg-slate-900/95 p-1 shadow-xl`}>{FORMATS.map((f) => <button key={f.id} role="menuitem" type="button" className={`${btn} w-full justify-start`} onClick={() => exportAs(f.id)}>{f.label}</button>)}</div>}
        </div>
      </header>

      <label className={`${glass} mb-6 flex items-center gap-2 rounded-xl px-3 py-2`}>
        <Search className="h-4 w-4 text-slate-400" aria-hidden /><span className="sr-only">Search highlights</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search quotes, notes and page titles" maxLength={200} className="w-full bg-transparent text-sm outline-none placeholder:text-slate-500" />
      </label>

      <div aria-live="polite" className="mb-3 min-h-5 text-xs text-emerald-300">{flash}</div>
      {error && <p role="alert" className="mb-4 rounded-lg border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">{error}</p>}

      {out && (
        <section className={`${glass} mb-6 rounded-2xl p-4`} aria-label="Export result">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">{FORMATS.find((f) => f.id === out.fmt)!.label}</h2>
            <div className="flex gap-1"><button type="button" className={btn} onClick={async () => say((await copyText(out.text)) ? 'Copied' : 'Copy failed. Select the text instead.')}><Copy className="h-3.5 w-3.5" />Copy</button><button type="button" className={btn} onClick={download}><Download className="h-3.5 w-3.5" />Download</button><button type="button" className={btn} onClick={() => setOut(null)}>Close</button></div></div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/30 p-3 text-xs text-slate-300">{out.text}</pre>
        </section>
      )}

      {!loading && !items.length && !error && (
        <div className={`${glass} rounded-2xl p-10 text-center`}><Quote className="mx-auto mb-3 h-8 w-8 text-slate-500" aria-hidden /><p className="font-medium">{q ? 'No highlights match that search.' : 'No highlights yet.'}</p>{!q && <p className="mt-1 text-sm text-slate-400">Select text on any page, then use the Bukmarkz button that appears (or right-click, Save highlight).</p>}</div>
      )}

      <div className="space-y-5">
        {groups.map(([key, list]) => {
          const m = meta[key], first = list[0];
          return (
            <article key={key} className={`${glass} rounded-2xl p-4`}>
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold text-white">{m?.title || first.source_title || host(first.source_url)}</h2>
                  <p className="truncate text-xs text-slate-400">{[m?.authors?.length ? m.authors.join(', ') : '', m?.container || host(first.source_url), m?.published ?? ''].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="flex shrink-0 gap-1"><a className={btn} href={safeHref(first.source_url)} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" />Open</a><button type="button" className={btn} onClick={() => setEditing(editing === key ? null : key)} aria-expanded={editing === key}><Pencil className="h-3.5 w-3.5" />Source details</button></div>
              </div>
              {editing === key && (
                <form className="mb-4 grid gap-3 rounded-xl bg-black/20 p-3 text-xs sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); saveMeta(first, new FormData(e.currentTarget)); }}>
                  {([['title', 'Title', m?.title], ['container', 'Site or journal', m?.container], ['publisher', 'Publisher', m?.publisher], ['published', 'Date (YYYY-MM-DD)', m?.published], ['doi', 'DOI (10.xxxx/…)', m?.doi]] as const).map(([name, label, v]) => (
                    <label key={name} className="grid gap-1"><span className="text-slate-400">{label}</span><input name={name} defaultValue={v ?? ''} className="rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-slate-100 outline-none focus:border-emerald-400" /></label>
                  ))}
                  <label className="grid gap-1 sm:row-span-2"><span className="text-slate-400">Authors (one per line)</span><textarea name="authors" rows={3} defaultValue={(m?.authors ?? []).join('\n')} className="rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-slate-100 outline-none focus:border-emerald-400" /></label>
                  <div className="flex items-end gap-2 sm:col-span-2"><button className="rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-500" type="submit">Save details</button><button type="button" className={btn} onClick={() => setEditing(null)}>Cancel</button></div>
                </form>
              )}
              <ul className="space-y-3">
                {list.map((h) => (
                  <li key={h.id} className="flex gap-3">
                    <input type="checkbox" className="mt-1.5 h-4 w-4 shrink-0 accent-emerald-500" checked={sel.has(h.id)} onChange={() => setSel((s) => { const n = new Set(s); n.has(h.id) ? n.delete(h.id) : n.add(h.id); return n; })} aria-label="Select this highlight for export" />
                    <div className="min-w-0 flex-1">
                      <blockquote className="border-l-2 border-emerald-400/60 pl-3 text-sm leading-relaxed text-slate-200">{h.quote}</blockquote>
                      <NoteEditor value={h.note} onSave={(v) => saveNote(h.id, v)} />
                      <div className="mt-1 flex flex-wrap gap-1">
                        <a className={btn} href={safeHref(h.fragmentUrl)} target="_blank" rel="noopener noreferrer"><Link2 className="h-3.5 w-3.5" />Jump to passage</a>
                        <button type="button" className={btn} onClick={async () => say((await copyText(h.fragmentUrl)) ? 'Link copied' : 'Copy failed')}><Copy className="h-3.5 w-3.5" />Copy link</button>
                        <button type="button" className={`${btn} hover:!text-rose-300`} onClick={() => remove(h.id)}><Trash2 className="h-3.5 w-3.5" />Delete</button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>

      <div className="mt-6 flex justify-center">{loading ? <Loader2 className="h-5 w-5 animate-spin text-emerald-400" aria-label="Loading" /> : next && <button type="button" className={`${btn} ${glass}`} onClick={() => load(false, next)}>Load more</button>}</div>
    </div>
  );
}

function NoteEditor({ value, onSave }: { value: string | null; onSave: (v: string) => void }) {
  const [open, setOpen] = useState(false), [v, setV] = useState(value ?? '');
  if (!open) return <button type="button" className="mt-1 block text-left text-xs text-slate-500 hover:text-slate-300" onClick={() => { setV(value ?? ''); setOpen(true); }}>{value ? <span className="text-slate-400">{value}</span> : '+ Add a note'}</button>;
  return (
    <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); onSave(v); setOpen(false); }}>
      <input aria-label="Note" autoFocus value={v} onChange={(e) => setV(e.target.value)} maxLength={1000} className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1 text-xs outline-none focus:border-emerald-400" />
      <button className={btn} type="submit" aria-label="Save note"><Check className="h-3.5 w-3.5" /></button>
    </form>
  );
}
