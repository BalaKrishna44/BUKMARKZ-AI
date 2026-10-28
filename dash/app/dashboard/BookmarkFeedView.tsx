'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import { startExtensionSync } from '@/lib/syncLoginToExtension';
import { ALL, ITEM_COLUMNS, MAX_TAGS, TASKS, UNSORTED, applyChange, domainOf, parseTagInput, rowFromPayload, searchMatches, splitTags, timeAgo, toBookmark, type Bookmark, type Category, type ItemRow } from '@/lib/bookmarks';

type ViewMode = 'list' | 'grid';
interface Props { initialBookmarks: Bookmark[]; initialCategories: Category[]; userId: string; userEmail: string; truncated?: boolean }
type Live = 'connecting' | 'live' | 'offline';
const LIMIT = 1000;
/** An expired or revoked session: send the user to sign in again instead of showing a vague error. */
const isAuthError = (e: { message?: string; status?: number; code?: string } | null) => !!e && (e.status === 401 || e.code === 'PGRST301' || /jwt|not authenticated/i.test(e.message ?? ''));
type Toast = { id: number; text: string; tone: 'ok' | 'err' } | null;
const PAGE = 60;                                  // rows rendered at once; more load as you scroll (keeps 1000 rows fast)

/* ───────────────────────────── small pieces ───────────────────────────── */
function Favicon({ b }: { b: Bookmark }) {
  const [bad, setBad] = useState(false);
  const host = domainOf(b.url);
  if (!b.faviconUrl || bad) return <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#2fa66a]/15 text-xs font-bold uppercase text-[#1a7f4e]">{host[0] ?? '?'}</span>;
  // eslint-disable-next-line @next/next/no-img-element -- tiny third-party icons; next/image would need every host allow-listed
  return <img src={b.faviconUrl} alt="" width={32} height={32} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBad(true)} className="size-8 shrink-0 rounded-lg bg-[#eaf3ed] object-contain p-1" />;
}

function TaskCheck({ b, toggle }: { b: Bookmark; toggle: (b: Bookmark) => void }) {
  const done = !!b.completedAt;
  return (
    <button type="button" role="checkbox" aria-checked={done} aria-label={`${done ? 'Reopen' : 'Mark done'}: ${b.title}`} onClick={() => toggle(b)}
      className={`grid size-6 shrink-0 place-items-center rounded-md border-2 outline-none focus-visible:ring-2 focus-visible:ring-[#2fa66a] ${done ? 'border-[#2fa66a] bg-[#2fa66a] text-[#04230f]' : 'border-[#9db3a5] bg-white hover:border-[#2fa66a]'}`}>
      {done && <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>}
    </button>);
}

function Tags({ tags, onPick, max }: { tags: string[]; onPick: (t: string) => void; max: number }) {
  if (!tags.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
      {tags.slice(0, max).map((t) => (
        <li key={t}><button type="button" onClick={() => onPick(t)} className="rounded-full bg-[#eaf3ed] px-2 py-0.5 text-[11px] font-medium text-[#1a7f4e] outline-none ring-[#2fa66a] hover:bg-[#dcefe3] focus-visible:ring-2">#{t}</button></li>
      ))}
      {tags.length > max && <li className="px-1 text-[11px] text-[#66766d]">+{tags.length - max}</li>}
    </ul>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', ''); return () => { if (d.open) d.close(); }; }, []);
  return (
    <dialog ref={ref} aria-labelledby="dlg-title" onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className="m-auto w-[min(92vw,480px)] rounded-2xl border border-[#d8eedf] bg-white p-0 text-[#26352d] shadow-2xl backdrop:bg-[#0f1a14]/50 backdrop:backdrop-blur-sm">
      <div className="p-5"><h2 id="dlg-title" className="text-base font-semibold text-[#10261c]">{title}</h2>{children}</div>
    </dialog>
  );
}

/* ───────────────────────────── quick actions ───────────────────────────── */
interface Actions { copy: (b: Bookmark) => void; edit: (b: Bookmark) => void; tags: (b: Bookmark) => void; toggle: (b: Bookmark) => void; move: (b: Bookmark, categoryId: string | null) => void; remove: (b: Bookmark) => void }
function ActionsMenu({ b, categories, actions, onOpenChange }: { b: Bookmark; categories: Category[]; actions: Actions; onOpenChange: (open: boolean) => void }) {
  const [open, setOpen] = useState(false), [sub, setSub] = useState(false), [up, setUp] = useState(false);
  const wrap = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const set = useCallback((v: boolean) => { setOpen(v); setSub(false); onOpenChange(v); }, [onOpenChange]);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) set(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { set(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', down); document.addEventListener('keydown', key);
    wrap.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key); };
  }, [open, sub, set]);
  const arrow = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(wrap.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])]; const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };
  const item = 'flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-[#33443b] outline-none hover:bg-[#10261c]/[0.06] focus-visible:bg-[#10261c]/[0.06]';
  return (
    <div ref={wrap} className="relative">
      <button ref={trigger} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`Actions for ${b.title}`}
        onClick={() => { if (!open) setUp(trigger.current ? trigger.current.getBoundingClientRect().bottom + 280 > window.innerHeight : false); set(!open); }}
        className="grid size-9 place-items-center rounded-lg text-[#4b5c53] outline-none hover:bg-[#10261c]/[0.06] hover:text-[#10261c] focus-visible:ring-2 focus-visible:ring-[#2fa66a]">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
      </button>
      {open && (
        <div role="menu" aria-label="Bookmark actions" onKeyDown={arrow} className={`absolute right-0 z-40 w-56 rounded-xl border border-[#d8eedf] bg-white p-1.5 shadow-2xl backdrop-blur ${up ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
          {!sub ? (<>
            <button role="menuitem" className={item} onClick={() => { actions.copy(b); set(false); }}>Copy link</button>
            <button role="menuitem" className={item} onClick={() => { actions.edit(b); set(false); }}>Edit note</button>
            <button role="menuitem" className={item} onClick={() => { actions.tags(b); set(false); }}>Edit tags</button>
            {b.isTask && <button role="menuitem" className={item} onClick={() => { actions.toggle(b); set(false); }}>{b.completedAt ? 'Reopen to-do' : 'Mark as done'}</button>}
            <button role="menuitem" className={item} onClick={() => setSub(true)} aria-haspopup="menu">Move to folder<span aria-hidden="true" className="ml-auto text-[#66766d]">›</span></button>
            <div role="separator" className="my-1 h-px bg-[#10261c]/[0.07]" />
            <button role="menuitem" className={`${item} text-rose-700`} onClick={() => { actions.remove(b); set(false); }}>Delete</button>
          </>) : (<div className="max-h-56 overflow-y-auto">
            <button role="menuitem" className={`${item} text-[#4b5c53]`} onClick={() => setSub(false)}>‹ Back</button>
            {[{ id: null as string | null, name: 'No folder' }, ...categories].map((c) => (
              <button key={c.id ?? 'none'} role="menuitemradio" aria-checked={b.categoryId === c.id} className={item} onClick={() => { actions.move(b, c.id); set(false); }}>
                <span aria-hidden="true" className="w-4 text-[#1a7f4e]">{b.categoryId === c.id ? '✓' : ''}</span><span className="truncate">{c.name}</span></button>))}
          </div>)}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── rows & cards ───────────────────────────── */
interface ItemProps { b: Bookmark; categoryName: string | null; categories: Category[]; actions: Actions; onTag: (t: string) => void }
const useRaise = () => { const [raised, setRaised] = useState(false); return { raised, setRaised }; };

function ListRow({ b, categoryName, categories, actions, onTag }: ItemProps) {
  const { raised, setRaised } = useRaise();
  return (
    <li className={`group relative flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[#2fa66a]/[0.06] ${raised ? 'z-30' : ''}`}>
      {b.isTask && <TaskCheck b={b} toggle={actions.toggle} />}
      <Favicon b={b} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <a href={b.url} target="_blank" rel="noopener noreferrer" className={`truncate text-sm font-medium outline-none hover:text-[#1a7f4e] focus-visible:underline ${b.completedAt ? 'text-[#66766d] line-through' : 'text-[#10261c]'}`}>{b.title}</a>
          <span className="hidden shrink-0 truncate text-xs text-[#66766d] sm:inline sm:max-w-[10rem]">{domainOf(b.url)}</span>
        </div>
        {b.summary && <p className="mt-0.5 truncate text-xs text-[#4b5c53]">{b.summary}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 sm:hidden"><span className="text-[11px] text-[#66766d]">{domainOf(b.url)}</span><time dateTime={b.createdAt} className="text-[11px] text-[#66766d]">{timeAgo(b.createdAt)}</time></div>
      </div>
      <div className="hidden w-48 shrink-0 lg:block"><Tags tags={b.tags} onPick={onTag} max={2} /></div>
      <div className="hidden w-32 shrink-0 justify-end xl:flex">{categoryName && <span className="truncate rounded-full bg-[#2fa66a]/15 px-2.5 py-0.5 text-[11px] font-medium text-[#1a7f4e]">{categoryName}</span>}</div>
      <time dateTime={b.createdAt} title={new Date(b.createdAt).toLocaleString()} className="hidden w-24 shrink-0 text-right text-xs text-[#66766d] sm:block">{timeAgo(b.createdAt)}</time>
      <ActionsMenu b={b} categories={categories} actions={actions} onOpenChange={setRaised} />
    </li>
  );
}

function GridCard({ b, categoryName, categories, actions, onTag }: ItemProps) {
  const { raised, setRaised } = useRaise();
  return (
    <li className={`group relative flex flex-col gap-3 rounded-2xl border border-[#d8eedf] bg-white p-4 backdrop-blur transition hover:border-[#2fa66a]/50 hover:bg-white ${raised ? 'z-30' : ''}`}>
      <div className="flex items-start gap-3">
        {b.isTask && <TaskCheck b={b} toggle={actions.toggle} />}
        <Favicon b={b} />
        <div className="min-w-0 flex-1"><p className="truncate text-xs text-[#4b5c53]">{domainOf(b.url)}</p>{categoryName && <p className="truncate text-[11px] text-[#1a7f4e]">{categoryName}</p>}</div>
        <ActionsMenu b={b} categories={categories} actions={actions} onOpenChange={setRaised} />
      </div>
      <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug text-[#10261c]"><a href={b.url} target="_blank" rel="noopener noreferrer" className={`outline-none hover:text-[#1a7f4e] focus-visible:underline ${b.completedAt ? 'text-[#66766d] line-through' : ''}`}>{b.title}</a></h3>
      <p className="line-clamp-3 min-h-[3.75rem] text-[13px] leading-5 text-[#4b5c53]">{b.summary ?? <span className="italic text-[#66766d]">Summary pending…</span>}</p>
      <p className="truncate text-[11px] text-[#66766d]" title={b.url}>{b.url}</p>
      <div className="mt-auto flex items-end justify-between gap-2"><Tags tags={b.tags} onPick={onTag} max={3} /><time dateTime={b.createdAt} title={new Date(b.createdAt).toLocaleString()} className="shrink-0 text-[11px] text-[#66766d]">{timeAgo(b.createdAt)}</time></div>
    </li>
  );
}

/* ───────────────────────────── main view ───────────────────────────── */
export default function BookmarkFeedView({ initialBookmarks, initialCategories, userId, userEmail, truncated }: Props) {
  const [supabase] = useState(() => createClient());
  const [items, setItems] = useState(initialBookmarks);
  const [categories, setCategories] = useState(initialCategories);
  const [live, setLive] = useState<Live>('connecting');
  const [tagging, setTagging] = useState<Bookmark | null>(null), [tagDraft, setTagDraft] = useState<string[]>([]), [tagText, setTagText] = useState('');
  const known = useRef(new Set(initialBookmarks.map((b) => b.id)));
  const [selectedCategory, setSelectedCategory] = useState<string>(ALL);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [visible, setVisible] = useState(PAGE);
  const [toast, setToast] = useState<Toast>(null);
  const [editing, setEditing] = useState<Bookmark | null>(null), [noteDraft, setNoteDraft] = useState('');
  const [deleting, setDeleting] = useState<Bookmark | null>(null), [busy, setBusy] = useState(false);
  const search = useRef<HTMLInputElement>(null), sentinel = useRef<HTMLDivElement>(null);
  const deferred = useDeferredValue(searchQuery);          // typing stays instant even with 1000 rows

  useEffect(() => { try { const v = localStorage.getItem('bk.view'); if (v === 'grid' || v === 'list') setViewMode(v); } catch { /* storage unavailable */ } }, []);
  const changeView = (v: ViewMode) => { setViewMode(v); try { localStorage.setItem('bk.view', v); } catch { /* ignore */ } };
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName)) { e.preventDefault(); search.current?.focus(); } }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, []);
  const say = useCallback((text: string, tone: 'ok' | 'err' = 'ok') => { const id = Date.now(); setToast({ id, text, tone }); setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 3500); }, []);

  /* auth: share the session with the extension; leave the page if the session is gone */
  useEffect(() => startExtensionSync(supabase), [supabase]);
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') window.location.assign('/login'); });
    return () => subscription.unsubscribe();
  }, [supabase]);
  const failed = useCallback((e: { message?: string; status?: number; code?: string } | null, text: string) => {
    if (isAuthError(e)) { window.location.assign('/login?next=/dashboard'); return; }
    say(text, 'err');
  }, [say]);

  /* full reload: used after a dropped realtime connection, so nothing that happened meanwhile is missed */
  const reload = useCallback(async () => {
    const [r, c] = await Promise.all([
      supabase.from('oneclist_items').select(ITEM_COLUMNS).eq('user_id', userId).order('created_at', { ascending: false }).limit(LIMIT),
      supabase.from('categories').select('id,name,position').eq('user_id', userId).order('position'),
    ]);
    if (r.error || c.error) { failed(r.error ?? c.error, 'Could not refresh your bookmarks'); return; }
    const next = ((r.data ?? []) as ItemRow[]).map(toBookmark).filter((b): b is Bookmark => b !== null);
    known.current = new Set(next.map((b) => b.id)); setItems(next); setCategories((c.data ?? []) as Category[]);
  }, [supabase, userId, failed]);

  /* realtime: a bookmark saved from the extension (or another tab) appears here without a refresh */
  useEffect(() => {
    let wasDown = false, closed = false;
    const refreshCategories = () => { void supabase.from('categories').select('id,name,position').eq('user_id', userId).order('position').then(({ data }) => { if (!closed && data) setCategories(data as Category[]); }); };
    const channel = supabase.channel(`bukmarkz-items-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'oneclist_items', filter: `user_id=eq.${userId}` }, (p: { eventType: string; new: unknown; old: unknown }) => {
        if (p.eventType === 'DELETE') {
          // DELETE payloads carry only the primary key and are not RLS-filtered, so act only on ids we are showing
          const id = (p.old as { id?: unknown } | null)?.id;
          if (typeof id === 'string' && known.current.has(id)) { known.current.delete(id); setItems((all) => applyChange(all, { kind: 'delete', id })); }
          return;
        }
        const row = rowFromPayload(p.new);
        if (!row) return;
        const fresh = !known.current.has(row.id) && toBookmark(row) !== null;
        known.current.add(row.id);
        setItems((all) => applyChange(all, { kind: 'upsert', row }));
        if (fresh && p.eventType === 'INSERT') say(`Saved: ${toBookmark(row)?.title ?? 'new bookmark'}`);
        if (row.category_id) { const cid = row.category_id; setCategories((cs) => { if (!cs.some((c) => c.id === cid)) refreshCategories(); return cs; }); }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories', filter: `user_id=eq.${userId}` }, refreshCategories)
      .subscribe((status: string) => {
        if (closed) return;
        if (status === 'SUBSCRIBED') { setLive('live'); if (wasDown) { wasDown = false; void reload(); } }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { wasDown = true; setLive('offline'); }
      });
    return () => { closed = true; void supabase.removeChannel(channel); };
  }, [supabase, userId, say, reload]);

  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const counts = useMemo(() => {
    const m = new Map<string, number>(); let unsorted = 0;
    items.forEach((b) => { if (b.categoryId && catName.has(b.categoryId)) m.set(b.categoryId, (m.get(b.categoryId) ?? 0) + 1); else unsorted++; });
    return { m, unsorted };
  }, [items, catName]);
  const openTasks = useMemo(() => items.filter((b) => b.isTask && !b.completedAt).length, [items]);
  const hasTasks = useMemo(() => items.some((b) => b.isTask), [items]);          // To-do stays listed after the last task is done, so finished ones can be reviewed
  const nav = useMemo(() => [{ id: ALL, name: 'All', count: items.length }, ...categories.map((c) => ({ id: c.id, name: c.name, count: counts.m.get(c.id) ?? 0 })), ...(counts.unsorted ? [{ id: UNSORTED, name: 'Unsorted', count: counts.unsorted }] : []), ...(hasTasks ? [{ id: TASKS, name: 'To-do', count: openTasks }] : [])], [items.length, categories, counts, openTasks, hasTasks]);

  const filtered = useMemo(() => items.filter((b) => {
    const inCat = selectedCategory === ALL || (selectedCategory === TASKS ? b.isTask : selectedCategory === UNSORTED ? !b.categoryId || !catName.has(b.categoryId) : b.categoryId === selectedCategory);
    return inCat && searchMatches(b, deferred, b.categoryId ? catName.get(b.categoryId) ?? null : null);
  }), [items, selectedCategory, deferred, catName]);
  useEffect(() => setVisible(PAGE), [selectedCategory, deferred, viewMode]);
  useEffect(() => {
    const el = sentinel.current; if (!el || visible >= filtered.length) return;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) setVisible((v) => v + PAGE); }, { rootMargin: '400px' }); io.observe(el); return () => io.disconnect();
  }, [visible, filtered.length]);

  /* One write helper. `.select('id')` makes a silent row-level-security refusal (0 rows changed) look like the failure it is. */
  const write = useCallback(async (id: string, values: Record<string, unknown>) => {
    const { data, error } = await supabase.from('oneclist_items').update(values).eq('id', id).select('id');
    return { error: error ?? (data && data.length ? null : { message: 'No row was changed' }) };
  }, [supabase]);

  /* actions: optimistic, rolled back if Supabase says no */
  const actions: Actions = {
    copy: (b) => { void (async () => { try { await navigator.clipboard.writeText(b.url); say('Link copied'); } catch { const t = document.createElement('textarea'); t.value = b.url; document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); say(ok ? 'Link copied' : 'Copy failed', ok ? 'ok' : 'err'); } })(); },
    edit: (b) => { setEditing(b); setNoteDraft(b.note ?? ''); },
    move: (b, categoryId) => {
      const prev = b.categoryId; setItems((all) => all.map((x) => (x.id === b.id ? { ...x, categoryId } : x)));
      void write(b.id, { category_id: categoryId }).then(({ error }) => {
        if (error) { setItems((all) => all.map((x) => (x.id === b.id ? { ...x, categoryId: prev } : x))); failed(error, 'Could not move that bookmark'); } else say(categoryId ? `Moved to ${catName.get(categoryId)}` : 'Removed from folder');
      });
    },
    remove: (b) => setDeleting(b),
    tags: (b) => { setTagging(b); setTagDraft(b.tags); setTagText(''); },
    toggle: (b) => {
      const prev = b.completedAt, next = prev ? null : new Date().toISOString();
      setItems((all) => all.map((x) => (x.id === b.id ? { ...x, completedAt: next } : x)));
      void write(b.id, { completed_at: next }).then(({ error }) => {
        if (error) { setItems((all) => all.map((x) => (x.id === b.id ? { ...x, completedAt: prev } : x))); failed(error, 'Could not update that to-do'); } else say(next ? 'Marked done' : 'Reopened');
      });
    },
  };
  async function saveNote() {
    if (!editing) return; const b = editing, note = noteDraft.trim().slice(0, 10_000) || null; setBusy(true);
    const { error } = await write(b.id, { note });
    setBusy(false); setEditing(null);
    if (error) failed(error, 'Could not save the note'); else { setItems((all) => all.map((x) => (x.id === b.id ? { ...x, note } : x))); say('Note saved'); }
  }
  function commitTagText() {
    const add = parseTagInput(tagText); if (!add.length) { setTagText(''); return; }
    setTagDraft((d) => [...new Set([...d, ...add])].slice(0, MAX_TAGS)); setTagText('');
  }
  async function saveTags() {
    if (!tagging) return; const b = tagging;
    const kept = [...new Set([...tagDraft, ...parseTagInput(tagText)])].slice(0, MAX_TAGS), cols = splitTags(b, kept); setBusy(true);
    const { error } = await write(b.id, cols);
    setBusy(false); setTagging(null);
    if (error) failed(error, 'Could not save the tags');
    else { setItems((all) => all.map((x) => (x.id === b.id ? { ...x, aiTags: cols.ai_tags, userTags: cols.tags, tags: [...cols.ai_tags, ...cols.tags] } : x))); say('Tags saved'); }
  }
  async function signOut() { await supabase.auth.signOut(); window.location.assign('/login'); }
  async function confirmDelete() {
    if (!deleting) return; const b = deleting; setBusy(true);
    const { data, error: err } = await supabase.from('oneclist_items').delete().eq('id', b.id).select('id');
    const error = err ?? (data && data.length ? null : { message: 'No row was deleted' });
    setBusy(false); setDeleting(null);
    if (error) failed(error, 'Could not delete that bookmark'); else { known.current.delete(b.id); setItems((all) => all.filter((x) => x.id !== b.id)); say('Bookmark deleted'); }
  }

  const shown = filtered.slice(0, visible);
  const common = (b: Bookmark) => ({ b, categoryName: b.categoryId ? catName.get(b.categoryId) ?? null : null, categories, actions, onTag: (t: string) => setSearchQuery('#' + t) });
  const heading = nav.find((n) => n.id === selectedCategory)?.name ?? 'All';

  return (
    <div className="min-h-screen bg-[#f1f9f4] text-[#33443b]">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-0 bg-[radial-gradient(60%_40%_at_20%_0%,rgba(37,169,93,.13),transparent),radial-gradient(40%_30%_at_90%_10%,rgba(163,230,53,.14),transparent)]" />
      <header className="sticky top-0 z-30 border-b border-[#d8eedf] bg-[#f1f9f4]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <span className="grid size-8 place-items-center rounded-lg bg-[#2fa66a] text-[#04230f]" aria-hidden="true"><svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" /></svg></span>
          <span className="hidden text-base font-bold tracking-tight text-[#10261c] sm:block">Bukmarkz</span>
          <div className="relative min-w-0 flex-1 sm:max-w-xl">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#66766d]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input ref={search} type="search" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} aria-label="Search bookmarks" placeholder="Search titles, links, summaries…  ( / )"
              className="h-10 w-full rounded-xl border border-[#d8eedf] bg-white pl-9 pr-3 text-sm text-[#10261c] outline-none placeholder:text-[#66766d] focus:border-[#2fa66a] focus:ring-2 focus:ring-[#2fa66a]/30" />
          </div>
          <div role="group" aria-label="View" className="flex shrink-0 rounded-xl border border-[#d8eedf] bg-white p-1">
            {(['list', 'grid'] as const).map((v) => (
              <button key={v} type="button" aria-pressed={viewMode === v} aria-label={v === 'list' ? 'List view' : 'Grid view'} onClick={() => changeView(v)}
                className={`grid size-8 place-items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[#2fa66a] ${viewMode === v ? 'bg-[#2fa66a] text-[#04230f]' : 'text-[#4b5c53] hover:text-[#10261c]'}`}>
                <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">{v === 'list' ? <path d="M4 6h16M4 12h16M4 18h16" /> : <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />}</svg></button>))}
          </div>
          <span role="status" title={live === 'live' ? 'Live: new saves appear instantly' : live === 'offline' ? 'Reconnecting… changes will catch up' : 'Connecting…'} className="flex shrink-0 items-center gap-1.5 text-xs text-[#4b5c53]">
            <span aria-hidden="true" className={`size-2 rounded-full ${live === 'live' ? 'bg-[#2fa66a]' : live === 'offline' ? 'bg-amber-500' : 'bg-[#9db3a5]'}`} />
            <span className="hidden sm:inline">{live === 'live' ? 'Live' : live === 'offline' ? 'Reconnecting' : 'Connecting'}</span>
          </span>
          <span className="hidden max-w-[10rem] truncate text-xs text-[#66766d] xl:block" title={userEmail}>{userEmail}</span>
          <button type="button" onClick={() => void signOut()} className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#4b5c53] outline-none hover:bg-[#10261c]/[0.06] focus-visible:ring-2 focus-visible:ring-[#2fa66a]">Sign out</button>
        </div>
      </header>

      <div className="relative mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Categories" className="lg:sticky lg:top-20 lg:self-start">
          <ul className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
            {nav.map((n) => (
              <li key={n.id} className="shrink-0">
                <button type="button" aria-current={selectedCategory === n.id ? 'page' : undefined} onClick={() => setSelectedCategory(n.id)}
                  className={`flex min-h-10 w-full items-center gap-2 rounded-xl px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-[#2fa66a] ${selectedCategory === n.id ? 'bg-[#2fa66a]/15 text-[#14532d] ring-1 ring-[#2fa66a]/40' : 'text-[#4b5c53] hover:bg-[#10261c]/[0.04] hover:text-[#33443b]'}`}>
                  <span className="truncate">{n.name}</span><span className="ml-auto rounded-full bg-[#10261c]/[0.07] px-2 py-0.5 text-[11px] tabular-nums text-[#4b5c53]">{n.count}</span></button>
              </li>))}
          </ul>
        </nav>

        <main className="min-w-0">
          <div className="mb-3 flex items-baseline justify-between gap-3"><h1 className="truncate text-xl font-bold tracking-tight text-[#10261c]">{heading}</h1><p aria-live="polite" className="shrink-0 text-xs text-[#66766d]">{filtered.length} {filtered.length === 1 ? 'bookmark' : 'bookmarks'}{deferred && ` for “${deferred}”`}</p></div>

          {items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#c6e4d0] bg-white/70 p-12 text-center"><h2 className="text-lg font-semibold text-[#10261c]">No bookmarks yet</h2><p className="mx-auto mt-2 max-w-sm text-sm text-[#4b5c53]">Install the Bukmarkz extension and press “Save current page”, or import a bookmarks file.</p></div>
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl border border-[#d8eedf] bg-white/70 p-12 text-center"><p className="text-sm text-[#4b5c53]">Nothing matches{deferred && ` “${deferred}”`}{selectedCategory !== ALL && ` in ${heading}`}.</p>
              <div className="mt-4 flex justify-center gap-2">{deferred && <button type="button" onClick={() => setSearchQuery('')} className="rounded-full bg-[#10261c]/[0.07] px-4 py-2 text-sm font-medium hover:bg-[#10261c]/10">Clear search</button>}{selectedCategory !== ALL && <button type="button" onClick={() => setSelectedCategory(ALL)} className="rounded-full bg-[#10261c]/[0.07] px-4 py-2 text-sm font-medium hover:bg-[#10261c]/10">Show all</button>}</div></div>
          ) : viewMode === 'list' ? (
            <ul className="divide-y divide-[#e3f1e8] rounded-2xl border border-[#d8eedf] bg-white backdrop-blur">{shown.map((b) => <ListRow key={b.id} {...common(b)} />)}</ul>
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{shown.map((b) => <GridCard key={b.id} {...common(b)} />)}</ul>
          )}
          {visible < filtered.length && <div ref={sentinel} className="py-6 text-center text-xs text-[#66766d]">Loading more…</div>}
          {truncated && visible >= filtered.length && <p className="py-6 text-center text-xs text-[#66766d]">Showing your newest 1,000 bookmarks.</p>}
        </main>
      </div>

      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
        {toast && <p className={`pointer-events-auto rounded-full px-4 py-2 text-sm font-medium shadow-xl backdrop-blur ${toast.tone === 'ok' ? 'bg-[#14532d] text-white' : 'bg-rose-700 text-white'}`}>{toast.text}</p>}
      </div>

      {editing && (
        <Modal title="Edit note" onClose={() => setEditing(null)}>
          <p className="mt-1 truncate text-xs text-[#66766d]">{editing.title}</p>
          <textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} rows={6} maxLength={10_000} aria-label="Note" autoFocus placeholder="Why does this matter? Markdown is fine."
            className="mt-3 w-full rounded-xl border border-[#d8eedf] bg-white p-3 text-sm text-[#10261c] outline-none focus:border-[#2fa66a] focus:ring-2 focus:ring-[#2fa66a]/30" />
          <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setEditing(null)} className="min-h-10 rounded-full px-4 text-sm text-[#4b5c53] hover:bg-[#10261c]/[0.06]">Cancel</button>
            <button type="button" disabled={busy} onClick={() => void saveNote()} className="min-h-10 rounded-full bg-[#2fa66a] px-5 text-sm font-semibold text-[#04230f] disabled:opacity-50">{busy ? 'Saving…' : 'Save note'}</button></div>
        </Modal>)}
      {tagging && (
        <Modal title="Edit tags" onClose={() => setTagging(null)}>
          <p className="mt-1 truncate text-xs text-[#66766d]">{tagging.title}</p>
          <ul className="mt-3 flex min-h-8 flex-wrap gap-1.5" aria-label="Current tags">
            {tagDraft.map((t) => (<li key={t} className="flex items-center gap-1 rounded-full bg-[#eaf3ed] py-0.5 pl-2.5 pr-1 text-xs font-medium text-[#1a7f4e]">#{t}
              <button type="button" aria-label={`Remove tag ${t}`} onClick={() => setTagDraft((d) => d.filter((x) => x !== t))} className="grid size-5 place-items-center rounded-full outline-none hover:bg-[#2fa66a]/20 focus-visible:ring-2 focus-visible:ring-[#2fa66a]">×</button></li>))}
            {tagDraft.length === 0 && <li className="text-xs text-[#66766d]">No tags yet</li>}
          </ul>
          <input value={tagText} onChange={(e) => setTagText(e.target.value)} aria-label="Add tags" autoFocus placeholder="Add tags, press Enter" maxLength={80}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commitTagText(); } else if (e.key === 'Backspace' && !tagText) setTagDraft((d) => d.slice(0, -1)); }}
            className="mt-3 h-10 w-full rounded-xl border border-[#d8eedf] bg-white px-3 text-sm text-[#10261c] outline-none focus:border-[#2fa66a] focus:ring-2 focus:ring-[#2fa66a]/30" />
          <p className="mt-1.5 text-[11px] text-[#66766d]">Up to {MAX_TAGS} tags. Spaces and commas separate tags; # is optional.</p>
          <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setTagging(null)} className="min-h-10 rounded-full px-4 text-sm text-[#4b5c53] hover:bg-[#10261c]/[0.06]">Cancel</button>
            <button type="button" disabled={busy} onClick={() => void saveTags()} className="min-h-10 rounded-full bg-[#2fa66a] px-5 text-sm font-semibold text-[#04230f] disabled:opacity-50">{busy ? 'Saving…' : 'Save tags'}</button></div>
        </Modal>)}
      {deleting && (
        <Modal title="Delete this bookmark?" onClose={() => setDeleting(null)}>
          <p className="mt-2 text-sm text-[#4b5c53]">“{deleting.title}” will be removed permanently. This can’t be undone.</p>
          <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setDeleting(null)} className="min-h-10 rounded-full px-4 text-sm text-[#4b5c53] hover:bg-[#10261c]/[0.06]">Cancel</button>
            <button type="button" disabled={busy} onClick={() => void confirmDelete()} className="min-h-10 rounded-full bg-rose-700 px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Deleting…' : 'Delete'}</button></div>
        </Modal>)}
    </div>
  );
}
