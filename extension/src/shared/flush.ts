import { API_BASE, SESSION_PATH, WEB_ORIGINS } from './config';

/**
 * "Flush Session": save every open tab of one window as a single Focus Session Stack, then close what was saved.
 * Written against small injected interfaces so the whole decision logic runs in unit tests without Chrome.
 *
 * Safety rules (each is tested):
 *  1. Tabs are closed ONLY after the server answered 2xx with an id. Any failure leaves every tab open.
 *  2. Never closed: the Bukmarkz tab(s), pinned tabs, and tabs the server did not accept (chrome://, file://, localhost, ...). Those simply stay open.
 *  3. Incognito windows are refused: their tabs must never be uploaded.
 *  4. If the window would end up with no tab, the saved-session page is opened first, so the window (and the browser) never closes by accident.
 */
export interface FlushTab { id?: number; url?: string; pendingUrl?: string; title?: string; favIconUrl?: string; pinned?: boolean; active?: boolean; incognito?: boolean }
export interface FlushDeps {
  queryTabs(q: { windowId?: number; currentWindow?: boolean }): Promise<FlushTab[]>;
  openTab(url: string): Promise<void>;
  closeTabs(ids: number[]): Promise<void>;
  token(): Promise<string | null>;
  hasTabsPermission(): Promise<boolean>;
  fetch: typeof fetch;
}
export type FlushResult =
  | { ok: true; url: string; saved: number; closed: number; kept: number }
  | { ok: false; error: 'not_signed_in' | 'permission' | 'incognito' | 'nothing' | 'network' | 'server' | 'rate_limited'; message: string };

const isWeb = (u: string | undefined) => { try { return !!u && WEB_ORIGINS.includes(new URL(u).origin); } catch { return false; } };
const isHttp = (u: string | undefined): u is string => { try { const p = new URL(u ?? '').protocol; return p === 'http:' || p === 'https:'; } catch { return false; } };
const MSG: Record<string, string> = {
  not_signed_in: 'Sign in at bukmarkz.com first. Your tabs were not touched.', permission: 'Bukmarkz needs permission to read your tab titles. Your tabs were not touched.',
  incognito: 'Flush is disabled in private windows. Your tabs were not touched.', nothing: 'No savable tabs here. Your tabs were not touched.',
  network: 'Could not reach Bukmarkz. Your tabs were not touched.', server: 'Bukmarkz could not save the session. Your tabs were not touched.', rate_limited: 'Too many flushes in the last hour. Your tabs were not touched.',
};
const fail = (error: Exclude<FlushResult, { ok: true }>['error']): FlushResult => ({ ok: false, error, message: MSG[error] });

export function pickTabs(tabs: FlushTab[]) {
  const save = tabs.filter((t) => isHttp(t.url) && !isWeb(t.url));                  // the dashboard is not part of the session
  return save.map((t) => ({ id: t.id, pinned: t.pinned === true, url: t.url!, title: (t.title ?? '').slice(0, 200), favicon: t.favIconUrl && /^https:/i.test(t.favIconUrl) ? t.favIconUrl : null }));
}

export async function flushSession(d: FlushDeps, windowId?: number): Promise<FlushResult> {
  const token = await d.token();
  if (!token) return fail('not_signed_in');
  if (!(await d.hasTabsPermission())) return fail('permission');
  const tabs = await d.queryTabs(windowId != null ? { windowId } : { currentWindow: true });
  if (tabs.some((t) => t.incognito)) return fail('incognito');
  const picked = pickTabs(tabs);
  if (!picked.length) return fail('nothing');

  let res: Response;
  try {
    res = await d.fetch(`${API_BASE}${SESSION_PATH}`, {
      method: 'POST', credentials: 'omit', signal: AbortSignal.timeout(20_000),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tabs: picked.map(({ url, title, favicon }) => ({ url, title, favicon })) }),
    });
  } catch { return fail('network'); }
  if (res.status === 401 || res.status === 403) return fail('not_signed_in');
  if (res.status === 429) return fail('rate_limited');
  let body: { ok?: boolean; id?: string; url?: string; tabCount?: number } = {};
  try { body = await res.json(); } catch { /* handled below */ }
  const sessionUrl = typeof body.url === 'string' && isWeb(body.url) ? body.url : null;     // only ever open a URL on our own origin
  if (!res.ok || body.ok !== true || !body.id || !sessionUrl) return fail('server');

  // Close only what is confirmed saved: same normalised URL set the server stored is unknown to us, so we close tabs we sent unless pinned.
  const toClose = picked.filter((t) => !t.pinned && t.id != null).map((t) => t.id!);
  const survivors = tabs.length - toClose.length;
  if (survivors === 0) await d.openTab(sessionUrl);                                         // keep the window alive and show the result
  if (toClose.length) await d.closeTabs(toClose);
  return { ok: true, url: sessionUrl, saved: body.tabCount ?? picked.length, closed: toClose.length, kept: tabs.length - toClose.length };
}
