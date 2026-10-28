import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clearFeedCache, fetchFeed, FeedError, readFeedCache, writeFeedCache } from '../lib/api';
import { getAuthState, onAuthChange, openSignIn, type AuthState } from '../lib/auth';
import { ALL, filterFeed, groupByCategory, hostOf, timeAgo, UNCATEGORIZED, type FeedItem } from '../lib/feed';
import { DASHBOARD_URL, LIMITS } from '../shared/config';
import { send } from '../shared/messages';
import { reminderPresets } from '../shared/reminders';
import { cleanTag, isSavableUrl } from '../shared/validate';

const incognito = chrome.extension?.inIncognitoContext === true;
type Tab = { id?: number; url: string; title: string; favicon?: string; description: string };
type SaveState = { phase: 'idle' | 'saving' | 'saved' | 'queued' | 'private' | 'error'; text?: string; signIn?: boolean };
type FeedState = { items: FeedItem[]; loading: boolean; error: string | null };

/** Active tab + its favicon and meta description. The description needs the one-time activeTab grant the popup click gives us. */
async function captureTab(): Promise<Tab | null> {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!t?.url || !isSavableUrl(t.url)) return null;
  let description = '';
  try {
    if (t.id !== undefined) {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId: t.id },
        func: () => { const m = (s: string) => document.querySelector<HTMLMetaElement>(s)?.content?.trim() ?? ''; return m('meta[name="description"]') || m('meta[property="og:description"]') || m('meta[name="twitter:description"]'); },
      });
      if (typeof r?.result === 'string') description = r.result.replace(/\s+/g, ' ').trim().slice(0, LIMITS.description);
    }
  } catch { /* restricted page or permission not granted: save without a description */ }
  const fav = t.favIconUrl && isSavableUrl(t.favIconUrl) ? t.favIconUrl : undefined;
  return { id: t.id, url: t.url, title: t.title ?? '', favicon: fav, description };
}

function Favicon({ src, host }: { src: string | null; host: string }) {
  const [bad, setBad] = useState(false);
  if (!src || bad) return <span aria-hidden="true" className="grid h-5 w-5 shrink-0 place-items-center rounded bg-slate-800 text-[10px] font-bold uppercase text-slate-400">{host[0] ?? '?'}</span>;
  return <img src={src} alt="" width={20} height={20} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBad(true)} className="h-5 w-5 shrink-0 rounded bg-slate-800 object-contain" />;
}

function Row({ it }: { it: FeedItem }) {
  const host = hostOf(it.url);
  return (
    <li>
      <a href={it.url} target="_blank" rel="noopener noreferrer" className="flex min-h-11 gap-2.5 rounded-lg px-2 py-2 hover:bg-slate-800/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#fca311]">
        <Favicon src={it.favicon_url} host={host} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-slate-100">{it.title}</span>
          <span className="block truncate text-[11px] text-slate-500">{host} · {timeAgo(it.created_at)}</span>
          {it.summary_tldr && <span className="mt-0.5 line-clamp-2 block text-[11px] leading-4 text-slate-400">{it.summary_tldr}</span>}
        </span>
      </a>
    </li>
  );
}

const PAGE = 25;
function List({ items }: { items: FeedItem[] }) {
  const [n, setN] = useState(PAGE);
  useEffect(() => setN(PAGE), [items]);
  return (
    <>
      <ul>{items.slice(0, n).map((it) => <Row key={it.id} it={it} />)}</ul>
      {items.length > n && <button type="button" onClick={() => setN(n + PAGE)} className="mt-1 w-full rounded-lg py-2 text-xs text-slate-400 hover:bg-slate-800">Show {Math.min(PAGE, items.length - n)} more</button>}
    </>
  );
}

function Accordion({ items }: { items: FeedItem[] }) {
  const groups = useMemo(() => groupByCategory(items), [items]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (name: string, i: number) => open[name] ?? i < 2;     // the two biggest groups start expanded
  return (
    <div className="space-y-1.5">
      {groups.map((g, i) => (
        <section key={g.name} className="rounded-xl bg-slate-900/70">
          <h3>
            <button type="button" aria-expanded={isOpen(g.name, i)} onClick={() => setOpen({ ...open, [g.name]: !isOpen(g.name, i) })} className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 text-left hover:bg-slate-800/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#fca311]">
              <svg aria-hidden="true" viewBox="0 0 20 20" className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform ${isOpen(g.name, i) ? 'rotate-90' : ''}`} fill="currentColor"><path d="M7 4l7 6-7 6z" /></svg>
              <span className="flex-1 truncate text-xs font-semibold uppercase tracking-wide text-slate-300">{g.name}</span>
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] tabular-nums text-slate-400">{g.items.length}</span>
            </button>
          </h3>
          {isOpen(g.name, i) && <div className="px-1 pb-1.5"><List items={g.items} /></div>}
        </section>
      ))}
    </div>
  );
}

export function Popup() {
  const [auth, setAuth] = useState<AuthState | undefined>(undefined);
  const [tab, setTab] = useState<Tab | null | undefined>(undefined);
  const [feed, setFeed] = useState<FeedState>({ items: [], loading: true, error: null });
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(ALL);
  const [save, setSave] = useState<SaveState>({ phase: 'idle' });
  const [more, setMore] = useState(false);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagText, setTagText] = useState('');
  const [reminderId, setReminderId] = useState('none');
  const presets = useMemo(() => reminderPresets(), []);
  const aborter = useRef<AbortController | null>(null);

  /* auth: read once, then follow changes made by the website / service worker */
  useEffect(() => {
    let alive = true;
    const read = () => void getAuthState().then((a) => alive && setAuth(a));
    read();
    const off = onAuthChange(read);
    return () => { alive = false; off(); };
  }, []);

  useEffect(() => {
    let alive = true;
    void captureTab().then((t) => { if (!alive) return; setTab(t); setTitle(t?.title.slice(0, LIMITS.title) ?? ''); });
    return () => { alive = false; };
  }, []);

  /* expired token: ask an open bukmarkz.com tab to renew it (it sends the new token; this popup updates by itself) */
  const [asked, setAsked] = useState<number | null>(null);
  useEffect(() => {
    if (auth?.status !== 'expired') { setAsked(null); return; }
    let alive = true;
    void send({ type: 'session:refresh' }).then((r) => { if (alive) setAsked(r.ok ? r.asked ?? 0 : 0); }, () => { if (alive) setAsked(0); });
    return () => { alive = false; };
  }, [auth?.status]);

  const userId = auth && auth.status !== 'signed-out' ? auth.user.id : null;
  const token = auth?.status === 'signed-in' ? auth.token : null;

  /** Paint the cache immediately (stale-while-revalidate), then fetch the newest. */
  const load = useCallback(async () => {
    if (!token || !userId) return;
    aborter.current?.abort();
    const ac = (aborter.current = new AbortController());
    if (!incognito) { const cached = await readFeedCache(userId); if (cached && !ac.signal.aborted) setFeed({ items: cached, loading: true, error: null }); }
    try {
      const items = await fetchFeed(token, ac.signal);
      setFeed({ items, loading: false, error: null });
      if (!incognito) void writeFeedCache(userId, items);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      const msg = e instanceof FeedError && e.code === 'unauthorized' ? 'Your session expired. Open bukmarkz.com to refresh it.' : e instanceof FeedError ? e.message : 'Something went wrong loading your bookmarks.';
      setFeed((f) => ({ ...f, loading: false, error: msg }));
    }
  }, [token, userId]);
  useEffect(() => { void load(); return () => aborter.current?.abort(); }, [load]);
  useEffect(() => { if (auth?.status === 'signed-out') { setFeed({ items: [], loading: false, error: null }); void clearFeedCache(); } }, [auth?.status]);

  const tabs = useMemo(() => {
    const counts = new Map<string, number>();
    feed.items.forEach((i) => counts.set(i.ai_category ?? UNCATEGORIZED, (counts.get(i.ai_category ?? UNCATEGORIZED) ?? 0) + 1));
    const names = [...counts].sort((a, b) => (a[0] === UNCATEGORIZED ? 1 : b[0] === UNCATEGORIZED ? -1 : b[1] - a[1])).map(([name, count]) => ({ name, count }));
    return [{ name: ALL, count: feed.items.length }, ...names];
  }, [feed.items]);
  useEffect(() => { if (category !== ALL && !tabs.some((t) => t.name === category)) setCategory(ALL); }, [tabs, category]);

  const shown = useMemo(() => filterFeed(feed.items, query, category), [feed.items, query, category]);
  const grouped = category === ALL && !query.trim();
  const alreadySaved = tab ? feed.items.some((i) => i.url.replace(/[#?].*$/, '').replace(/\/$/, '') === tab.url.replace(/[#?].*$/, '').replace(/\/$/, '')) : false;

  async function savePage() {
    if (!tab || save.phase === 'saving') return;
    const pending = cleanTag(tagText);
    const finalTags = pending && tags.length < LIMITS.tags && !tags.includes(pending) ? [...tags, pending] : tags;
    setSave({ phase: 'saving' });
    try {
      const res = await send({ type: 'save', input: { url: tab.url, title, note, tags: finalTags, remindAt: presets.find((p) => p.id === reminderId)?.at ?? null, private: incognito, favicon: tab.favicon, description: tab.description } });
      if (!res.ok) { setSave({ phase: 'error', text: res.error, signIn: res.code === 'not_signed_in' || res.code === 'invalid_token' }); return; }
      const st = res.item?.status;
      setSave(st === 'queued' ? { phase: 'queued', text: 'Saved. Will sync when online.' } : st === 'local-private' ? { phase: 'private', text: 'Saved privately on this device.' } : { phase: 'saved' });
      setNote(''); setTags([]); setTagText(''); setReminderId('none');
      if (st === 'synced') void load();
      setTimeout(() => setSave((s) => (s.phase === 'saving' ? s : { phase: 'idle' })), 2500);
    } catch {
      setSave({ phase: 'error', text: 'Something went wrong. Close and reopen the popup.' });
    }
  }

  const btnLabel = save.phase === 'saving' ? 'Saving…' : save.phase === 'saved' ? 'Saved!' : save.phase === 'queued' ? 'Saved (offline)' : save.phase === 'private' ? 'Saved privately' : incognito ? 'Save privately' : alreadySaved ? 'Save again' : 'Save current page';
  const field = 'w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-[#fca311] focus:outline-none focus:ring-2 focus:ring-[#fca311]/40';
  const lbl = 'mb-1 mt-3 block text-[11px] font-medium uppercase tracking-wide text-slate-400';

  return (
    <main className="min-h-[220px] bg-[#05070d] p-3.5 text-slate-100">
      <header className="mb-3 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#fca311] text-[#14213d]" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" /></svg>
        </span>
        <span className="text-base font-bold tracking-tight">Bukmarkz <span className="text-[#fca311]">AI</span></span>
        {incognito && <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[11px] text-violet-200" title="Saves stay on this device">Private</span>}
        <button type="button" onClick={() => void chrome.tabs.create({ url: DASHBOARD_URL })} className="ml-auto rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#fca311]">Open app</button>
      </header>

      {auth === undefined && <p role="status" className="py-8 text-center text-sm text-slate-400">Loading…</p>}

      {auth?.status === 'signed-out' && (
        <section aria-label="Sign in" className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 text-center">
          <h1 className="text-base font-semibold">Your bookmarks, organised by AI</h1>
          <p className="mt-1.5 text-sm leading-5 text-slate-400">Sign in once at bukmarkz.com. This extension connects automatically.</p>
          <button type="button" onClick={() => void openSignIn()} className="mt-4 w-full rounded-lg bg-[#fca311] px-3 py-2.5 text-sm font-bold text-[#14213d] hover:bg-[#ffb23e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Sign in with Bukmarkz</button>
        </section>
      )}

      {auth?.status === 'expired' && (
        <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-400/10 p-3 text-sm text-amber-100">
          {asked === null || asked > 0
            ? 'Reconnecting to Bukmarkz… Saves made meanwhile are kept and sent afterwards.'
            : <>Your session needs a refresh. <button type="button" onClick={() => void openSignIn()} className="font-semibold text-[#fca311] underline">Open Bukmarkz</button> and it reconnects on its own. Saves made meanwhile are kept and sent afterwards.</>}
        </p>
      )}

      {auth && auth.status !== 'signed-out' && (
        <>
          {tab === null && <p className="rounded-lg bg-slate-900 p-3 text-sm text-slate-300">This page can’t be saved. Bukmarkz saves regular web pages (http and https).</p>}
          {tab && (
            <section aria-label="Save this page">
              <button type="button" onClick={() => void savePage()} disabled={save.phase === 'saving'} aria-live="polite"
                className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-wait ${save.phase === 'saved' || save.phase === 'private' ? 'bg-emerald-400 text-[#052e1a]' : save.phase === 'error' ? 'bg-red-400 text-red-950' : 'bg-[#fca311] text-[#14213d] hover:bg-[#ffb23e]'}`}>
                {save.phase === 'saving' && <span aria-hidden="true" className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#14213d]/30 border-t-[#14213d] motion-reduce:animate-none" />}
                {save.phase === 'saved' && <span aria-hidden="true">✓</span>}
                {btnLabel}
              </button>
              <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
                <Favicon src={tab.favicon ?? null} host={hostOf(tab.url)} />
                <span className="min-w-0 flex-1 truncate" title={tab.url}>{tab.title || hostOf(tab.url)}</span>
                <button type="button" aria-expanded={more} onClick={() => setMore(!more)} className="shrink-0 rounded px-1.5 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#fca311]">{more ? 'Hide' : 'Note, tags…'}</button>
              </div>
              {save.text && <p role={save.phase === 'error' ? 'alert' : 'status'} className={`mt-2 rounded-lg px-3 py-2 text-xs ${save.phase === 'error' ? 'bg-red-500/15 text-red-200' : 'bg-emerald-500/15 text-emerald-200'}`}>{save.text} {save.signIn && <button type="button" onClick={() => void openSignIn()} className="font-semibold underline">Open Bukmarkz</button>}</p>}
              {more && (
                <div className="mt-1">
                  <label htmlFor="bk-title" className={lbl}>Title</label>
                  <input id="bk-title" className={field} value={title} maxLength={LIMITS.title} onChange={(e) => setTitle(e.target.value)} />
                  <label htmlFor="bk-note" className={lbl}>Note <span className="normal-case text-slate-500">(Markdown)</span></label>
                  <textarea id="bk-note" className={`${field} min-h-[64px] resize-y`} value={note} maxLength={LIMITS.note} placeholder="Why does this matter?" onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void savePage(); } }} />
                  <label htmlFor="bk-tag" className={lbl}>Tags</label>
                  <input id="bk-tag" className={field} value={tagText} maxLength={LIMITS.tag} placeholder="Add a tag, press Enter" onChange={(e) => setTagText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); const t = cleanTag(tagText); if (t && tags.length < LIMITS.tags && !tags.includes(t)) setTags([...tags, t]); setTagText(''); } else if (e.key === 'Backspace' && !tagText && tags.length) setTags(tags.slice(0, -1)); }} />
                  {tags.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1.5">{tags.map((t) => <button key={t} type="button" aria-label={`Remove tag ${t}`} onClick={() => setTags(tags.filter((x) => x !== t))} className="rounded-full bg-[#fca311] px-2 py-0.5 text-xs font-semibold text-[#14213d]">#{t} ×</button>)}</div>}
                  <label htmlFor="bk-rem" className={lbl}>Remind me</label>
                  <select id="bk-rem" className={field} value={reminderId} onChange={(e) => setReminderId(e.target.value)}>{presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
                </div>
              )}
            </section>
          )}

          <section aria-label="Your bookmarks" className="mt-4">
            <div className="relative">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input type="search" aria-label="Search bookmarks" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${feed.items.length || ''} bookmarks`.replace('  ', ' ')} className={`${field} pl-8`} />
            </div>
            <div role="tablist" aria-label="Categories" className="-mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1 pb-1.5 [scrollbar-width:thin]">
              {tabs.map((t) => (
                <button key={t.name} role="tab" type="button" aria-selected={category === t.name} onClick={() => setCategory(t.name)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#fca311] ${category === t.name ? 'bg-[#fca311] text-[#14213d]' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
                  {t.name} <span className={category === t.name ? 'text-[#14213d]/70' : 'text-slate-500'}>{t.count}</span>
                </button>
              ))}
            </div>
            <div role="tabpanel" aria-busy={feed.loading} className="mt-1 max-h-[340px] overflow-y-auto pr-0.5">
              {feed.error && <p role="alert" className="mb-2 rounded-lg bg-red-500/10 p-3 text-xs text-red-200">{feed.error} <button type="button" onClick={() => void load()} className="font-semibold underline">Retry</button></p>}
              {feed.loading && feed.items.length === 0 && <div aria-hidden="true" className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-11 animate-pulse rounded-lg bg-gradient-to-r from-slate-800 via-slate-700 to-slate-800 motion-reduce:animate-none" />)}</div>}
              {!feed.loading && !feed.error && feed.items.length === 0 && <p className="rounded-lg bg-slate-900 p-4 text-center text-sm text-slate-400">Nothing saved yet. Press “Save current page” to add your first bookmark.</p>}
              {feed.items.length > 0 && shown.length === 0 && <p className="p-4 text-center text-sm text-slate-400">No bookmarks match “{query}”.</p>}
              {shown.length > 0 && (grouped ? <Accordion items={shown} /> : <List items={shown} />)}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
