/**
 * Extension side of Deep Cite (drop into ext3/src/background/highlights.ts).
 *   - `collectHighlight` runs INSIDE the tab (chrome.scripting.executeScript serialises it, so it must stay self-contained, no imports).
 *     It only reads the selection and the page's own meta tags and returns plain strings. The server cleans and validates all of it.
 *   - `saveHighlightFromTab` is the right-click path ("Save highlight"); `handleHighlightMessage` serves the optional selection toolbar
 *     (content-highlights.ts). Incognito tabs are never sent anywhere, matching how the rest of the extension treats private browsing.
 *   - The page URL always comes from the browser's tab record, never from what a content script claims.
 */

export const HIGHLIGHT_MENU = { id: 'bukmarkz-highlight', title: 'Save Highlight to Bukmarkz', contexts: ['selection'] } as const;
export const HIGHLIGHT_MSG = 'bukmarkz:highlight';

export interface HighlightPayload {
  quote: string; prefix: string; suffix: string; title: string;
  page: { title: string; metas: [string, string][]; ld: string[] };
}

/** Serialised into the page. No imports, no closures over module scope. */
export function collectHighlight(): HighlightPayload | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const quote = sel.toString().slice(0, 6000);
  if (quote.replace(/\s+/g, ' ').trim().length < 3) return null;
  const r = sel.getRangeAt(0);
  const near = (n: Node, from: 'end' | 'start', offset: number): string => {
    const t = n.nodeType === Node.TEXT_NODE ? (n.textContent ?? '') : '';
    return (from === 'end' ? t.slice(Math.max(0, offset - 60), offset) : t.slice(offset, offset + 60)).replace(/\s+/g, ' ').trim();
  };
  const metas: [string, string][] = [];
  document.querySelectorAll('meta[name], meta[property]').forEach((m) => {
    if (metas.length >= 200) return;
    const k = m.getAttribute('name') || m.getAttribute('property') || '', v = m.getAttribute('content') || '';
    if (k && v) metas.push([k.slice(0, 100), v.slice(0, 2000)]);
  });
  const ld: string[] = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    const t = s.textContent ?? '';
    if (ld.length < 5 && t.length > 0 && t.length <= 100_000) ld.push(t);
  });
  return { quote, prefix: near(r.startContainer, 'end', r.startOffset), suffix: near(r.endContainer, 'start', r.endOffset), title: document.title.slice(0, 500), page: { title: document.title.slice(0, 1000), metas, ld } };
}

export type HighlightResult = { ok: true; duplicate: boolean } | { ok: false; error: string };

async function post(p: HighlightPayload, url: string, token: string, apiBase: string): Promise<HighlightResult> {
  let res: Response;
  try {
    res = await fetch(`${apiBase}/api/highlights`, {
      method: 'POST', credentials: 'omit',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ url, title: p.title, quote: p.quote, prefix: p.prefix, suffix: p.suffix, page: p.page }),
    });
  } catch { return { ok: false, error: 'Could not reach Bukmarkz.' }; }
  const j = await res.json().catch(() => ({} as any));
  if (res.status === 401) return { ok: false, error: 'Your Bukmarkz session expired. Open bukmarkz.com to refresh it.' };
  if (!res.ok) return { ok: false, error: j.message || 'Could not save the highlight.' };
  return { ok: true, duplicate: !!j.duplicate };
}

export async function saveHighlightFromTab(opts: { tab: { id?: number; url?: string; title?: string; incognito?: boolean }; token: string | null; apiBase: string }): Promise<HighlightResult> {
  const { tab, token, apiBase } = opts;
  if (tab.incognito) return { ok: false, error: 'Highlights are not saved from private windows.' };
  if (!token) return { ok: false, error: 'Sign in to Bukmarkz first.' };
  if (tab.id === undefined || !/^https?:\/\//i.test(tab.url ?? '')) return { ok: false, error: 'Highlights can only be saved on regular web pages.' };
  let found: HighlightPayload | null = null;
  try {
    const res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectHighlight });
    found = (res[0]?.result as HighlightPayload | null | undefined) ?? null;
  } catch { return { ok: false, error: 'Could not read this page.' }; }
  if (!found) return { ok: false, error: 'Select some text first.' };
  return post(found, tab.url!, token, apiBase);
}

/** For chrome.runtime.onMessage. Returns true when it handled the message (so the listener can keep the channel open for the async reply). */
export function handleHighlightMessage(msg: any, sender: chrome.runtime.MessageSender, getToken: () => Promise<string | null>, apiBase: string, reply: (r: HighlightResult) => void): boolean {
  if (!msg || msg.type !== HIGHLIGHT_MSG || sender.id !== chrome.runtime.id || !sender.tab) return false;
  const tab = sender.tab, p = msg.payload as HighlightPayload | undefined;
  (async () => {
    if (tab.incognito) return reply({ ok: false, error: 'Highlights are not saved from private windows.' });
    if (!/^https?:\/\//i.test(tab.url ?? '') || !p || typeof p.quote !== 'string') return reply({ ok: false, error: 'Highlights can only be saved on regular web pages.' });
    const token = await getToken();
    if (!token) return reply({ ok: false, error: 'Sign in to Bukmarkz first.' });
    reply(await post(p, tab.url!, token, apiBase));
  })().catch(() => reply({ ok: false, error: 'Could not save the highlight.' }));
  return true;
}

export function highlightNotice(r: HighlightResult): { title: string; body: string } {
  if (!r.ok) return { title: 'Highlight not saved', body: r.error };
  return r.duplicate ? { title: 'Already saved', body: 'That passage is already in your highlights.' } : { title: 'Highlight saved', body: 'Find it, with a link back to the exact passage, under Highlights.' };
}
