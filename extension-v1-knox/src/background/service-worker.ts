import { ApiError, fetchUser, logoutRemote, saveBookmark } from '../shared/api';
import { DASHBOARD_URL, WEB_ORIGINS } from '../shared/config';
import type { ToWorker, WorkerReply } from '../shared/messages';
import {
  clearSession, getQueue, getRecent, getReminders, getSession, getTagHistory, pushRecent, rememberTags, removeRecent,
  setQueue, setReminders, setSession, updateRecent,
} from '../shared/storage';
import type { SaveInput, SavedItem, Session } from '../shared/types';
import { isSavableUrl, normalizeUrl, sanitizeSave } from '../shared/validate';

const MENU_ID = 'save-to-bukmarkz';
const FLUSH_ALARM = 'bukmarkz:flush';
const REMIND_PREFIX = 'bukmarkz:remind:';

/* ------------------------------------------------------------------ session */

/** The stored session, or null if signed out or expired. An expired token is removed. */
async function liveSession(): Promise<Session | null> {
  const s = await getSession();
  if (!s) return null;
  if (s.expiry && Date.parse(s.expiry) <= Date.now()) {
    await clearSession();
    return null;
  }
  return s;
}

const publicSession = (s: Session | null) => (s ? { user: s.user, expiry: s.expiry } : null);

function fromWebOrigin(url: string | undefined): boolean {
  if (!url) return false;
  try { return WEB_ORIGINS.includes(new URL(url).origin); } catch { return false; }
}

async function handleLogin(token: string, expiry: string | null): Promise<WorkerReply> {
  try {
    const user = await fetchUser(token); // never trust a token we have not verified with the server
    await setSession({ token, expiry, user, syncedAt: Date.now() });
    await refreshBadge();
    void flushQueue();
    return { ok: true, session: { user, expiry } };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: e.message, code: e.code };
    return { ok: false, error: 'Could not verify the session.', code: 'server' };
  }
}

async function handleLogout(): Promise<WorkerReply> {
  const s = await getSession();
  await clearSession();
  if (s) void logoutRemote(s.token); // the site usually already did this; ignore failures
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
  if (!session) return { ok: false, error: 'Sign in at bukmarkz.com to save.', code: 'not_signed_in' };

  try {
    const result = await saveBookmark(session.token, input);
    item.status = 'synced';
    item.serverId = result.id;
  } catch (e) {
    if (e instanceof ApiError && e.code === 'invalid_token') {
      await clearSession();
      await refreshBadge();
      return { ok: false, error: 'Your session ended. Sign in again at bukmarkz.com.', code: 'invalid_token' };
    }
    if (e instanceof ApiError && e.code === 'bad_input') return { ok: false, error: e.message, code: 'bad_input' };
    // network trouble or a server error: keep it and retry later
    await setQueue([...(await getQueue()).filter((q) => q.url !== item.url), item]);
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
      const r = await saveBookmark(session.token, { url: item.url, title: item.title, note: item.note, tags: item.tags, remindAt: item.remindAt, private: false });
      await updateRecent(item.id, { status: 'synced', serverId: r.id });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'bad_input') continue; // will never succeed, drop it
      if (e instanceof ApiError && e.code === 'invalid_token') { await clearSession(); remaining.push(item); break; }
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
    chrome.contextMenus.create({ id: MENU_ID, title: 'Save to Bukmarkz', contexts: ['page', 'link', 'selection'] });
  });
}

async function onMenuClick(info: chrome.contextMenus.OnClickData, tab: chrome.tabs.Tab | undefined): Promise<void> {
  const target = info.linkUrl ?? info.pageUrl ?? tab?.url;
  if (!isSavableUrl(target)) return;
  const reply = await save({
    url: normalizeUrl(target),
    title: info.linkUrl ? '' : tab?.title ?? '',
    note: info.selectionText ? `> ${info.selectionText.trim().slice(0, 500)}` : '',
    tags: [], remindAt: null,
    private: tab?.incognito === true,
  });
  if (!reply.ok) await notify('Not saved', reply.error);
  else if (reply.item?.private) await notify('Saved privately', 'Kept on this device only.');
}

/* ------------------------------------------------------------------ messages */

chrome.runtime.onMessage.addListener((message: ToWorker, sender, sendResponse) => {
  void (async (): Promise<WorkerReply> => {
    if (sender.id !== chrome.runtime.id) return { ok: false, error: 'Unknown sender.' };
    switch (message?.type) {
      case 'bridge:login':
        // Only the content script running on bukmarkz.com may hand us a session.
        if (!fromWebOrigin(sender.tab?.url ?? sender.url)) return { ok: false, error: 'Not allowed from this page.' };
        if (typeof message.token !== 'string' || message.token.length < 16 || message.token.length > 256) return { ok: false, error: 'Bad token.', code: 'bad_input' };
        return handleLogin(message.token, typeof message.expiry === 'string' ? message.expiry : null);
      case 'bridge:logout':
        if (!fromWebOrigin(sender.tab?.url ?? sender.url)) return { ok: false, error: 'Not allowed from this page.' };
        return handleLogout();
      case 'session:get':
        return { ok: true, session: publicSession(await liveSession()) };
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
  void flushQueue();
});

chrome.contextMenus.onClicked.addListener((info, tab) => void onMenuClick(info, tab));
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'save-current-tab') return;
  const active = tab ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  await openOverlay(active);
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === FLUSH_ALARM) return void flushQueue();
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
