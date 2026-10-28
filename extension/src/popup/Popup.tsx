import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DASHBOARD_URL, LIMITS } from '../shared/config';
import { send } from '../shared/messages';
import { reminderPresets } from '../shared/reminders';
import type { SavedItem, SessionUser } from '../shared/types';
import { cleanTag, isSavableUrl } from '../shared/validate';

type Tab = { url: string; title: string };
type Notice = { kind: 'ok' | 'err'; text: string; signIn?: boolean } | null;

const incognito = chrome.extension?.inIncognitoContext === true;

async function currentTab(): Promise<Tab | null> {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t?.url && isSavableUrl(t.url) ? { url: t.url, title: t.title ?? '' } : null;
}

const STATUS_LABEL: Record<SavedItem['status'], string> = { synced: 'Synced', queued: 'Waiting to sync', 'local-private': 'Private' };
const STATUS_STYLE: Record<SavedItem['status'], string> = {
  synced: 'bg-emerald-500/15 text-emerald-300',
  queued: 'bg-amber-400/15 text-amber-300',
  'local-private': 'bg-violet-500/20 text-violet-200',
};

export function Popup() {
  const [tab, setTab] = useState<Tab | null | undefined>(undefined); // undefined = still loading
  const [user, setUser] = useState<SessionUser | null>(null);
  const [recent, setRecent] = useState<SavedItem[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagText, setTagText] = useState('');
  const [reminderId, setReminderId] = useState('none');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const presets = useMemo(() => reminderPresets(), []);

  const refresh = useCallback(async () => {
    const [r, t] = await Promise.all([send({ type: 'recent:get' }), send({ type: 'tags:get' })]);
    if (r.ok) { setRecent(r.items ?? []); setUser(r.session?.user ?? null); }
    if (t.ok) setHistory(t.tags ?? []);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const t = await currentTab();
      if (!alive) return;
      setTab(t);
      setTitle(t?.title.slice(0, LIMITS.title) ?? '');
      await refresh();
    })();
    return () => { alive = false; };
  }, [refresh]);

  const alreadySaved = tab ? recent.some((r) => r.url.replace(/\/$/, '') === tab.url.replace(/[#?].*$/, '').replace(/\/$/, '')) : false;

  function addTag(raw: string) {
    const t = cleanTag(raw);
    if (t && tags.length < LIMITS.tags && !tags.includes(t)) setTags([...tags, t]);
    setTagText('');
  }
  const toggleTag = (t: string) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : cur.length < LIMITS.tags ? [...cur, t] : cur));

  async function save() {
    if (!tab || busy) return;
    const finalTags = cleanTag(tagText) && tags.length < LIMITS.tags ? [...tags, cleanTag(tagText)] : tags;
    setBusy(true);
    setNotice(null);
    try {
      const res = await send({ type: 'save', input: { url: tab.url, title, note, tags: finalTags, remindAt: presets.find((p) => p.id === reminderId)?.at ?? null, private: incognito } });
      if (res.ok) {
        const st = res.item?.status;
        setNotice({ kind: 'ok', text: st === 'local-private' ? 'Saved privately on this device.' : st === 'queued' ? 'Saved. Will sync when you are online.' : 'Saved to Bukmarkz.' });
        setNote(''); setTags([]); setTagText(''); setReminderId('none');
        await refresh();
      } else {
        setNotice({ kind: 'err', text: res.error, signIn: res.code === 'not_signed_in' || res.code === 'invalid_token' });
        await refresh();
      }
    } catch {
      setNotice({ kind: 'err', text: 'Something went wrong. Close and reopen the popup.' });
    } finally {
      setBusy(false);
    }
  }

  const openDashboard = () => void chrome.tabs.create({ url: DASHBOARD_URL });
  const remove = async (id: string) => { await send({ type: 'recent:remove', id }); await refresh(); };

  const field = 'w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-[#fca311] focus:outline-none focus:ring-2 focus:ring-[#fca311]/40';
  const label = 'mb-1 mt-3 block text-[11px] font-medium uppercase tracking-wide text-slate-400';

  return (
    <main className="min-h-[200px] bg-[#05070d] p-3.5 text-slate-100">
      <header className="mb-3 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#fca311] text-[#14213d]" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" /></svg>
        </span>
        <span className="text-base font-bold tracking-tight">Bukmarkz <span className="text-[#fca311]">AI</span></span>
        {incognito && <span className="ml-auto rounded-full bg-violet-500/20 px-2 py-0.5 text-[11px] text-violet-200" title="Saved only on this device">Private window</span>}
        <button type="button" onClick={openDashboard} className={`${incognito ? '' : 'ml-auto '}rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#fca311]`}>Open app</button>
      </header>

      {tab === undefined && <p className="py-6 text-center text-sm text-slate-400" role="status">Loading…</p>}

      {tab === null && (
        <p className="rounded-lg bg-slate-900 p-3 text-sm text-slate-300">This page cannot be saved. Bukmarkz saves regular web pages (http and https).</p>
      )}

      {tab && !user && !incognito && (
        <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-400/10 p-3 text-sm text-amber-100">
          You are signed out. <button type="button" onClick={openDashboard} className="font-semibold text-[#fca311] underline">Sign in at bukmarkz.com</button> and this extension connects automatically.
        </div>
      )}

      {tab && (
        <section aria-label="Save this page">
          <label htmlFor="bk-title" className={label}>Title</label>
          <input id="bk-title" className={field} value={title} maxLength={LIMITS.title} onChange={(e) => setTitle(e.target.value)} />
          <p className="mt-1 truncate text-[11px] text-slate-500" title={tab.url}>{tab.url}</p>
          {alreadySaved && !notice && <p className="mt-1 text-[11px] text-amber-300">You saved this page recently. Saving again updates it.</p>}

          <label htmlFor="bk-note" className={label}>Quick note <span className="normal-case text-slate-500">(Markdown)</span></label>
          <textarea
            id="bk-note" ref={noteRef} className={`${field} min-h-[72px] resize-y`} value={note} maxLength={LIMITS.note}
            placeholder="Why does this matter? **bold**, - lists, [links](url)"
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); } }}
          />

          <label htmlFor="bk-tag" className={label}>Tags</label>
          <input
            id="bk-tag" className={field} value={tagText} maxLength={LIMITS.tag} placeholder="Add a tag, press Enter"
            onChange={(e) => setTagText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagText); }
              else if (e.key === 'Backspace' && !tagText && tags.length) setTags(tags.slice(0, -1));
            }}
          />
          <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Tag choices">
            {[...new Set([...tags, ...history])].slice(0, 12).map((t) => (
              <button
                key={t} type="button" aria-pressed={tags.includes(t)} onClick={() => toggleTag(t)}
                className={`rounded-full border px-2 py-0.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#fca311] ${tags.includes(t) ? 'border-[#fca311] bg-[#fca311] font-semibold text-[#14213d]' : 'border-slate-700 bg-slate-800 text-slate-200 hover:border-slate-500'}`}
              >#{t}</button>
            ))}
          </div>

          <label htmlFor="bk-rem" className={label}>Remind me</label>
          <select id="bk-rem" className={field} value={reminderId} onChange={(e) => setReminderId(e.target.value)}>
            {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>

          <button
            type="button" onClick={() => void save()} disabled={busy}
            className="mt-4 w-full rounded-lg bg-[#fca311] px-3 py-2.5 text-sm font-bold text-[#14213d] hover:bg-[#ffb23e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-wait disabled:opacity-60"
          >{busy ? 'Saving…' : incognito ? 'Save privately' : 'Save'}</button>
          <p className="mt-1.5 text-center text-[11px] text-slate-500">⌘/Ctrl+Enter to save</p>

          {notice && (
            <p role={notice.kind === 'err' ? 'alert' : 'status'} className={`mt-2 rounded-lg px-3 py-2 text-xs ${notice.kind === 'err' ? 'bg-red-500/15 text-red-200' : 'bg-emerald-500/15 text-emerald-200'}`}>
              {notice.text}{' '}
              {notice.signIn && <button type="button" onClick={openDashboard} className="font-semibold underline">Open Bukmarkz</button>}
            </p>
          )}
        </section>
      )}

      <section aria-label="Recent saves" className="mt-5">
        <h2 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">Recent saves</h2>
        {recent.length === 0 ? (
          <p className="rounded-lg bg-slate-900 p-3 text-xs text-slate-400">Nothing saved yet. Press ⌘/Ctrl+Shift+S on any page.</p>
        ) : (
          <ul className="space-y-1.5">
            {recent.map((r) => (
              <li key={r.id} className="group flex items-start gap-2 rounded-lg bg-slate-900 p-2">
                <div className="min-w-0 flex-1">
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="block truncate text-sm font-medium text-slate-100 hover:text-[#fca311]">{r.title}</a>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                    {r.remindAt && <span className="text-[10px] text-slate-400">⏰ {new Date(r.remindAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
                    {r.tags.slice(0, 3).map((t) => <span key={t} className="text-[10px] text-slate-400">#{t}</span>)}
                  </div>
                  {r.note && <p className="mt-1 line-clamp-2 text-[11px] text-slate-400">{r.note}</p>}
                </div>
                <button type="button" aria-label={`Remove ${r.title} from recent list`} onClick={() => void remove(r.id)} className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#fca311]">×</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
