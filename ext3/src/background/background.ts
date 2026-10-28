import { ApiError, fetchUser, saveBookmark } from '../shared/api';
import { DASHBOARD_URL, WEB_ORIGINS } from '../shared/config';

/** Replaced by esbuild (`false` in every normal build) so the test hook below is deleted from the shipped bundle. */
declare const __TEST_HOOKS__: boolean | undefined;
import { jwtExp, looksLikeJwt } from '../shared/jwt';
import { buildSaveFromMenu, MENU } from '../shared/menu';
import type { ToWorker, WorkerReply } from '../shared/messages';
import {
  clearSession, getQueue, getRecent, getReminders, getSession, getTagHistory, pushRecent, rememberTags, removeRecent,
  setQueue, setReminders, setSession, updateRecent,
} from '../shared/storage';
import type { SaveInput, SavedItem, Session } from '../shared/types';
import { isSavableUrl, normalizeUrl, sanitizeSave } from '../shared/validate';

const FLUSH_ALARM = 'bukmarkz:flush';
const REMIND_PREFIX = 'bukmarkz:remind:';
const REFRESH_ALARM = 'bukmarkz:refresh';
const REFRESH_LEAD_S = 120;          // ask the website for a new token this long before the old one expires
const REFRESH_GAP_MS = 30_000;       // never ask more often than this (tabs, alarms and the popup can all trigger it)
let lastAsk = 0;

/* ------------------------------------------------------------------ session */

const SKEW_S = 30; // treat a token as expired 30 s early so a save never races the expiry

const isFresh = (s: Session) => s.expiresAt - SKEW_S > Date.now() / 1000;

/**
 * Token refresh. The refresh token never leaves the website (Supabase rotates it; two holders would sign each other out), so
 * the extension cannot renew by itself. Instead it asks any open bukmarkz.com tab to renew and send the new access token back.
 * Returns how many tabs were asked; 0 means no site tab is open and the user must open one (the popup says so).
 */
async function requestRefresh(force = false): Promise<number> {
  if (!force && Date.now() - lastAsk < REFRESH_GAP_MS) return 0;
  lastAsk = Date.now();
  let tabs: chrome.tabs.Tab[] = [];
  try { tabs = await chrome.tabs.query({ url: WEB_ORIGINS.map((o) => `${o}/*`) }); } catch { return 0; }
  let asked = 0;
  for (const t of tabs.slice(0, 3)) {
    if (t.id === undefined) continue;
    try { await chrome.tabs.sendMessage(t.id, { type: 'bridge:refresh-request' }); asked++; } catch { /* tab without our content script (loading, or discarded) */ }
  }
  return asked;
}

function scheduleRefresh(expiresAt: number): void {
  const when = Math.max(Date.now() + 5_000, (expiresAt - REFRESH_LEAD_S) * 1000);
  chrome.alarms.create(REFRESH_ALARM, { when });
}

/** The stored session if its token is still valid; null if signed out OR expired. */
async function liveSession(): Promise<Session | null> {
  const s = await getSession();
  return s && isFresh(s) ? s : null;
}

const publicSession = (s: Session | null) => (s ? { user: s.user, expiresAt: s.expiresAt } : null);

function fromWebOrigin(url: string | undefined): boolean {
  if (!url) return false;
  try { return WEB_ORIGINS.includes(new URL(url).origin); } catch { return false; }
}

/**
 * The website hands us its current Supabase access token. We never trust it blindly:
 *  - the expiry comes from the token itself, and the server verifies the signature (GET /api/ingest) before we store anything;
 *  - with "incognito": "spanning" this worker is shared by normal and incognito windows, so an incognito tab may not
 *    replace a different account's session.
 */
async function handleLogin(accessToken: string, fromIncognito: boolean): Promise<WorkerReply> {
  if (!looksLikeJwt(accessToken)) return { ok: false, error: 'Bad token.', code: 'bad_input' };
  const exp = jwtExp(accessToken);
  if (!exp || exp - SKEW_S <= Date.now() / 1000) return { ok: false, error: 'That session has expired.', code: 'invalid_token' };
  try {
    const user = await fetchUser(accessToken);
    const current = await getSession();
    if (fromIncognito && current && current.user.id !== user.id) return { ok: false, error: 'A different account is already connected.', code: 'bad_input' };
    await setSession({ accessToken, expiresAt: exp, user, syncedAt: Date.now() });
    scheduleRefresh(exp);
    await refreshBadge();
    void flushQueue();                                        // anything saved while the token was expired goes out now
    return { ok: true, session: { user, expiresAt: exp } };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: e.message, code: e.code };
    return { ok: false, error: 'Could not verify the session.', code: 'server' };
  }
}

async function handleLogout(fromIncognito: boolean): Promise<WorkerReply> {
  // Signing out of an incognito tab must not sign the normal window out of the shared extension.
  if (fromIncognito) return { ok: true, session: publicSession(await liveSession()) };
  await clearSession();
  void chrome.alarms.clear(REFRESH_ALARM);
  await refreshBadge();
  return { ok: true, session: null };
}

/* -------------------------------------------------------------------- saving */

async function scheduleReminder(item: SavedItem): Promise<void> {
  if (!item.remindAt) return;
  const reminders = (await getReminders()).filter((r) => r.id !== item.id);
  reminders.push({ id: item.id, url: item.url, title: item.title, at: item.remindAt, private: item.private, fired: false });
  await setReminders(reminders);
  chrome.alarms.create(REMIND_PREFIX + item.id, { when: item.remindAt });
}

async function save(raw: SaveInput, fromIncognitoTab = false): Promise<WorkerReply> {
  const input = sanitizeSave(raw);
  if (!input) return { ok: false, error: 'This page cannot be saved.', code: 'bad_input' };
  if (fromIncognitoTab) input.private = true; // the browser tells us this, the page cannot lie about it

  const item: SavedItem = {
    id: crypto.randomUUID(), url: input.url, title: input.title || new URL(input.url).hostname, note: input.note,
    tags: input.tags, remindAt: input.remindAt, private: input.private, status: 'queued', savedAt: Date.now(),
    kind: input.kind ?? 'page', ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
    ...(input.favicon ? { favicon: input.favicon } : {}), ...(input.description ? { description: input.description } : {}),
  };

  // Private (incognito) saves stay on this device. The server has no private flag for them yet, so uploading would break the promise.
  if (input.private) {
    item.status = 'local-private';
    await pushRecent(item);
    await scheduleReminder(item);
    await rememberTags(item.tags);
    return { ok: true, item };
  }

  const session = await liveSession();
  if (!session) {
    // Expired (not signed out): keep the save and send it as soon as the website refreshes the session.
    if (await getSession()) {
      void requestRefresh();                                  // the queue is sent when the new token arrives (handleLogin -> flushQueue)
      await setQueue([...(await getQueue()).filter((q) => !(q.url === item.url && q.kind === item.kind && q.note === item.note)), item]);
      await pushRecent(item); await scheduleReminder(item); await rememberTags(item.tags); await refreshBadge();
      return { ok: true, item };
    }
    return { ok: false, error: 'Sign in at bukmarkz.com to save.', code: 'not_signed_in' };
  }

  try {
    const result = await saveBookmark(session.accessToken, input);
    item.status = 'synced';
    item.serverId = result.id;
  } catch (e) {
    if (e instanceof ApiError && e.code === 'invalid_token') {
      // The server no longer accepts this token (expired early or revoked). Keep the save and mark the session stale so
      // the badge shows "!" until the website sends a fresh token; signing out for real arrives as bridge:logout.
      const stale = await getSession();
      if (stale) await setSession({ ...stale, expiresAt: 0 });
      void requestRefresh(true);
    }
    if (e instanceof ApiError && e.code === 'bad_input') return { ok: false, error: e.message, code: 'bad_input' };
    // network trouble or a server error: keep it and retry later
    await setQueue([...(await getQueue()).filter((q) => !(q.url === item.url && q.kind === item.kind && q.note === item.note)), item]);
  }

  await pushRecent(item);
  await scheduleReminder(item);
  await rememberTags(item.tags);
  await refreshBadge();
  if (item.status === 'synced') void flashSaved(); // a queued save is not "done", so it keeps the count badge
  return { ok: true, item };
}

async function flushQueue(): Promise<void> {
  const session = await liveSession();
  const queue = await getQueue();
  if (!session || queue.length === 0) return;
  const remaining: SavedItem[] = [];
  for (const item of queue) {
    try {
      const r = await saveBookmark(session.accessToken, { url: item.url, title: item.title, note: item.note, tags: item.tags, remindAt: item.remindAt, private: false, kind: item.kind ?? 'page', imageUrl: item.imageUrl, favicon: item.favicon, description: item.description });
      await updateRecent(item.id, { status: 'synced', serverId: r.id });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'bad_input') continue; // will never succeed, drop it
      if (e instanceof ApiError && e.code === 'invalid_token') { remaining.push(item); break; }   // keep the session record: the website will refresh it
      remaining.push(item);
    }
  }
  await setQueue(remaining);
  await refreshBadge();
}

/* --------------------------------------------------------------------- badge */

async function refreshBadge(): Promise<void> {
  const [session, queue] = await Promise.all([liveSession(), getQueue()]);
  if (queue.length > 0) {
    await chrome.action.setBadgeBackgroundColor({ color: '#fca311' });
    await chrome.action.setBadgeTextColor?.({ color: '#14213d' });
    await chrome.action.setBadgeText({ text: String(queue.length) });
  } else if (!session) {
    await chrome.action.setBadgeBackgroundColor({ color: '#b45f06' });
    await chrome.action.setBadgeText({ text: '!' });
  } else {
    await chrome.action.setBadgeText({ text: '' });
  }
}

async function flashSaved(): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
  await chrome.action.setBadgeText({ text: '✓' });
  setTimeout(() => void refreshBadge(), 1800);
}

/* ------------------------------------------------------------------- overlay */

async function openOverlay(tab: chrome.tabs.Tab | undefined): Promise<void> {
  if (!tab?.id || !isSavableUrl(tab.url)) {
    await notify('Cannot save this page', 'Bukmarkz can only save regular web pages (http or https).');
    return;
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['overlay.js'] });
  } catch {
    // pages like the Chrome Web Store block injection
    await notify('Cannot open the overlay here', 'Click the Bukmarkz icon in the toolbar to save this page instead.');
  }
}

async function notify(title: string, message: string, id?: string): Promise<void> {
  await chrome.notifications.create(id ?? '', { type: 'basic', iconUrl: 'icons/icon-128.png', title, message });
}

/* ----------------------------------------------------------- context menu ---- */

function createMenu(): void {
  chrome.contextMenus.removeAll(() => {
    for (const m of Object.values(MENU)) chrome.contextMenus.create({ id: m.id, title: m.title, contexts: [...m.contexts] });
  });
}

async function onMenuClick(info: chrome.contextMenus.OnClickData, tab: chrome.tabs.Tab | undefined): Promise<void> {
  const built = buildSaveFromMenu(info, tab);
  if (!built.ok) return notify('Not saved', built.reason);
  const reply = await save(built.input);
  if (!reply.ok) return notify('Not saved', reply.error);
  const item = reply.item!;
  if (item.private) return notify('Saved privately', 'Kept on this device only.');
  if (item.status === 'queued') return notify('Saved, waiting to sync', 'It will upload as soon as Bukmarkz can be reached. Open bukmarkz.com if this stays.');
  if (item.kind === 'image') return notify('Image saved', 'Text recognition is not available yet.');
  if (item.kind === 'selection') return notify('Saved as a note', item.title || item.url);
}

/* ------------------------------------------------------------------ messages */

chrome.runtime.onMessage.addListener((message: ToWorker, sender, sendResponse) => {
  void (async (): Promise<WorkerReply> => {
    if (sender.id !== chrome.runtime.id) return { ok: false, error: 'Unknown sender.' };
    switch (message?.type) {
      case 'bridge:login':
        // Only the content script running on bukmarkz.com may hand us a session.
        if (!fromWebOrigin(sender.tab?.url ?? sender.url)) return { ok: false, error: 'Not allowed from this page.' };
        return handleLogin(String(message.accessToken ?? ''), sender.tab?.incognito === true);
      case 'bridge:logout':
        if (!fromWebOrigin(sender.tab?.url ?? sender.url)) return { ok: false, error: 'Not allowed from this page.' };
        return handleLogout(sender.tab?.incognito === true);
      case 'session:get':
        return { ok: true, session: publicSession(await liveSession()) };
      case 'session:refresh':
        return { ok: true, asked: await requestRefresh(), session: publicSession(await liveSession()) };
      case 'save':
        return save(message.input, sender.tab?.incognito === true);
      case 'recent:get':
        return { ok: true, items: await getRecent(), session: publicSession(await liveSession()) };
      case 'tags:get':
        return { ok: true, tags: await getTagHistory() };
      case 'recent:remove':
        await removeRecent(String(message.id));
        return { ok: true };
      case 'queue:flush':
        await flushQueue();
        return { ok: true, items: await getRecent() };
      default:
        return { ok: false, error: 'Unknown message.' };
    }
  })().then(sendResponse);
  return true; // keep the channel open for the async reply
});

/* -------------------------------------------------------------- lifecycle ---- */

chrome.runtime.onInstalled.addListener(async (details) => {
  createMenu();
  chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: 5 });
  await refreshBadge();
  if (details.reason === 'install') await chrome.tabs.create({ url: DASHBOARD_URL });
});

chrome.runtime.onStartup.addListener(async () => {
  chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: 5 });
  // Alarms can be lost across a browser restart; rebuild reminders from storage.
  const week = 7 * 86_400_000;
  const kept = (await getReminders()).filter((r) => r.at > Date.now() - week); // forget reminders ignored for a week
  await setReminders(kept);
  for (const r of kept) {
    if (!r.fired && r.at > Date.now()) chrome.alarms.create(REMIND_PREFIX + r.id, { when: r.at });
  }
  await refreshBadge();
  const stored = await getSession();
  if (stored && !isFresh(stored)) void requestRefresh(true);
  void flushQueue();
});

chrome.contextMenus.onClicked.addListener((info, tab) => void onMenuClick(info, tab));

// Test builds only (BUKMARKZ_TEST_HOOKS=1): Playwright cannot click Chrome's native context menu, so it calls the handler directly.
if (typeof __TEST_HOOKS__ !== 'undefined' && __TEST_HOOKS__) (globalThis as unknown as { __bk: unknown }).__bk = { onMenuClick, handleLogin, handleLogout, requestRefresh };
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'save-current-tab') return;
  const active = tab ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  await openOverlay(active);
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === FLUSH_ALARM) { if (!(await liveSession()) && (await getSession())) void requestRefresh(); return void flushQueue(); }
  if (alarm.name === REFRESH_ALARM) return void requestRefresh(true);
  if (!alarm.name.startsWith(REMIND_PREFIX)) return;
  const id = alarm.name.slice(REMIND_PREFIX.length);
  const reminders = await getReminders();
  const r = reminders.find((x) => x.id === id);
  if (!r) return;
  await setReminders(reminders.map((x) => (x.id === id ? { ...x, fired: true } : x)));
  // private pages never put their title or address in a notification other people might see
  await notify('Time to revisit', r.private ? 'A private page you saved is due for review.' : r.title || r.url, `remind:${r.id}`);
});

chrome.notifications.onClicked.addListener(async (id) => {
  if (!id.startsWith('remind:')) return;
  const reminders = await getReminders();
  const r = reminders.find((x) => x.id === id.slice('remind:'.length));
  if (r && isSavableUrl(r.url)) await chrome.tabs.create({ url: r.url });
  if (r) await setReminders(reminders.filter((x) => x.id !== r.id));
  chrome.notifications.clear(id);
});
