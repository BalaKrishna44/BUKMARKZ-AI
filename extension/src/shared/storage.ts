import { LIMITS } from './config';
import type { Reminder, SavedItem, Session } from './types';

const K = { session: 'bukmarkz.session', recent: 'bukmarkz.recent', queue: 'bukmarkz.queue', reminders: 'bukmarkz.reminders', tags: 'bukmarkz.tags' } as const;

async function get<T>(key: string, fallback: T): Promise<T> {
  const res = await chrome.storage.local.get(key);
  return (res[key] as T | undefined) ?? fallback;
}
const set = (key: string, value: unknown) => chrome.storage.local.set({ [key]: value });

export const getSession = () => get<Session | null>(K.session, null);
export const setSession = (s: Session) => set(K.session, s);
export const clearSession = () => chrome.storage.local.remove(K.session);

export const getRecent = () => get<SavedItem[]>(K.recent, []);
export async function pushRecent(item: SavedItem): Promise<void> {
  const rest = (await getRecent()).filter((r) => r.url !== item.url);
  await set(K.recent, [item, ...rest].slice(0, LIMITS.recentSaves));
}
export async function updateRecent(id: string, patch: Partial<SavedItem>): Promise<void> {
  const all = await getRecent();
  await set(K.recent, all.map((r) => (r.id === id ? { ...r, ...patch } : r)));
}
export async function removeRecent(id: string): Promise<void> {
  await set(K.recent, (await getRecent()).filter((r) => r.id !== id));
}

/** Saves waiting for a connection. Holds only non-private items. */
export const getQueue = () => get<SavedItem[]>(K.queue, []);
export const setQueue = (q: SavedItem[]) => set(K.queue, q);

export const getReminders = () => get<Reminder[]>(K.reminders, []);
export const setReminders = (r: Reminder[]) => set(K.reminders, r);

/** Tags the user used before, most recent first, for one-tap reuse. */
export const getTagHistory = () => get<string[]>(K.tags, []);
export async function rememberTags(tags: string[]): Promise<void> {
  const merged = [...tags, ...(await getTagHistory())].filter((t, i, a) => a.indexOf(t) === i).slice(0, 20);
  await set(K.tags, merged);
}
