/**
 * Extension side of the Snippet Extractor (drop into ext3/src/background/snippets.ts).
 *   - Context-menu entries: "Save selection as code snippet" (selection) and "Extract code snippets from this page" (page).
 *   - `collectInPage` runs INSIDE the tab (chrome.scripting.executeScript serialises it, so it must stay self-contained).
 *     It only reads the DOM and returns plain strings; the server re-cleans, re-detects the language and re-checks for secrets.
 *   - Incognito tabs are never sent anywhere, matching how the rest of the extension treats private browsing.
 * Wire-up (3 small edits to background.ts) is in README.md.
 */

export const SNIPPET_MENU = {
  selection: { id: 'bukmarkz-snippet-selection', title: 'Save Selection as Code Snippet', contexts: ['selection'] },
  page: { id: 'bukmarkz-snippet-page', title: 'Extract Code Snippets from This Page', contexts: ['page'] },
} as const;

export interface RawSnippet { code: string; language: string; title: string }

/** Serialised into the page. No imports, no closures over module scope. */
export function collectInPage(mode: 'selection' | 'page'): RawSnippet[] {
  const MAX = 20, MAX_CHARS = 20_000;
  const langOf = (el: Element | null): string => {
    for (let n: Element | null = el, i = 0; n && i < 4; n = n.parentElement, i++) {
      const a = n.getAttribute('data-lang') || n.getAttribute('data-language') || n.getAttribute('lang') || '';
      if (a && !/^[a-z]{2}(-[A-Z]{2})?$/.test(a)) return a;           // `lang="en"` on <html> is a human language, not a code language
      const m = /(?:^|\s)(?:language|lang|highlight-source|brush:?)[-_: ]*([\w+#-]+)/i.exec(typeof n.className === 'string' ? n.className : '');
      if (m) return m[1];
    }
    return '';
  };
  if (mode === 'selection') {
    const sel = window.getSelection();
    const text = (sel?.toString() ?? '').slice(0, MAX_CHARS * 2);
    if (!text.trim()) return [];
    const anchor = sel?.anchorNode instanceof Element ? sel.anchorNode : sel?.anchorNode?.parentElement ?? null;
    return [{ code: text, language: langOf(anchor), title: '' }];
  }
  const out: RawSnippet[] = [], seen = new Set<string>();
  for (const pre of Array.from(document.querySelectorAll('pre'))) {
    if (out.length >= MAX) break;
    const r = pre.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;                    // hidden blocks (collapsed tabs, templates)
    const clone = pre.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('button, svg, .linenos, .line-number, .lineno, .hljs-ln-numbers, .gutter, [class*="copy"], [aria-hidden="true"]').forEach((n) => n.remove());
    const code = (clone.textContent ?? '').replace(/\r\n?/g, '\n');
    const key = code.replace(/\s+/g, ' ').trim();
    if (key.length < 12 || code.length > MAX_CHARS * 2 || seen.has(key)) continue;
    seen.add(key);
    let title = '';                                                   // nearest heading above the block
    for (let n: Element | null = pre; n && !title; n = n.parentElement) {
      for (let s = n.previousElementSibling; s; s = s.previousElementSibling) {
        const h = /^H[1-4]$/.test(s.tagName) ? s : s.querySelector('h1,h2,h3,h4');
        if (h) { title = (h.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120); break; }
      }
    }
    out.push({ code, language: langOf(pre.querySelector('code') ?? pre), title });
  }
  return out;
}

export type SnippetResult = { ok: true; saved: number; skipped: number; rejected: number } | { ok: false; error: string };

export async function saveSnippetsFromTab(opts: { tab: { id?: number; url?: string; title?: string; incognito?: boolean }; mode: 'selection' | 'page'; token: string | null; apiBase: string }): Promise<SnippetResult> {
  const { tab, mode, token, apiBase } = opts;
  if (tab.incognito) return { ok: false, error: 'Snippets are not saved from private windows.' };
  if (!token) return { ok: false, error: 'Sign in to Bukmarkz first.' };
  if (tab.id === undefined || !/^https?:\/\//i.test(tab.url ?? '')) return { ok: false, error: 'Snippets can only be extracted from regular web pages.' };

  let found: RawSnippet[] = [];
  try {
    const res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectInPage, args: [mode] });
    found = (res[0]?.result as RawSnippet[] | undefined) ?? [];
  } catch { return { ok: false, error: 'Could not read this page.' }; }
  if (!found.length) return { ok: false, error: mode === 'selection' ? 'Select some code first.' : 'No code blocks found on this page.' };

  let res: Response;
  try {
    res = await fetch(`${apiBase}/api/snippets`, {
      method: 'POST', credentials: 'omit',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ sourceUrl: tab.url, sourceTitle: (tab.title ?? '').slice(0, 200), snippets: found.slice(0, 20).map((s) => ({ code: s.code, language: s.language.slice(0, 30), title: s.title })) }),
    });
  } catch { return { ok: false, error: 'Could not reach Bukmarkz.' }; }
  const j = await res.json().catch(() => ({} as any));
  if (res.status === 401) return { ok: false, error: 'Your Bukmarkz session expired. Open bukmarkz.com to refresh it.' };
  if (res.status === 422) return { ok: false, error: j.rejected?.some((r: any) => String(r.reason).startsWith('looks_like_secret')) ? 'That code looks like it contains a secret, so it was not saved.' : 'Nothing worth saving was found.' };
  if (!res.ok) return { ok: false, error: j.message || 'Could not save snippets.' };
  return { ok: true, saved: j.saved ?? 0, skipped: j.skipped ?? 0, rejected: Array.isArray(j.rejected) ? j.rejected.length : 0 };
}

export function snippetMessage(r: SnippetResult): { title: string; body: string } {
  if (!r.ok) return { title: 'Snippet not saved', body: r.error };
  if (r.saved === 0) return { title: 'Already in your vault', body: `${r.skipped} snippet${r.skipped === 1 ? ' was' : 's were'} already saved.` };
  return { title: `Saved ${r.saved} snippet${r.saved === 1 ? '' : 's'}`, body: [r.skipped ? `${r.skipped} already saved` : '', r.rejected ? `${r.rejected} skipped (too short or looked like secrets)` : ''].filter(Boolean).join(' · ') || 'Find them in your Snippet Vault.' };
}
