import { LIMITS, OCR_AVAILABLE } from './config';
import { isSavableUrl } from './validate';
import type { SaveInput } from './types';

export const MENU = {
  page: { id: 'bukmarkz-save-page', title: 'Save Page to Bukmarkz', contexts: ['page', 'link'] },
  selection: { id: 'bukmarkz-save-selection', title: 'Save Selection as Rich Note', contexts: ['selection'] },
  image: { id: 'bukmarkz-save-image', title: OCR_AVAILABLE ? 'Save Image and Extract Text (OCR)' : 'Save Image to Bukmarkz', contexts: ['image'] },
} as const;

/** Escape characters that would break a Markdown link label. */
const esc = (s: string) => s.replace(/[\[\]\\]/g, '\\$&');
/** Keep ( ) and spaces from ending a Markdown link early. */
const mdUrl = (u: string) => u.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');

/** Quote the selection and cite the page, as Markdown. */
export function selectionNote(text: string, title: string, url: string): string {
  const quote = text.trim().slice(0, LIMITS.richNote - 400).split(/\r?\n/).map((l) => `> ${l}`.trimEnd()).join('\n');
  return `${quote}\n\n— [${esc(title || new URL(url).hostname)}](${mdUrl(url)})`;
}

type Tab = { url?: string; title?: string; incognito?: boolean } | undefined;
type Click = { menuItemId: string | number; pageUrl?: string; linkUrl?: string; selectionText?: string; srcUrl?: string };

/** Turns a context-menu click into a save request, or a human reason why it cannot be saved. */
export function buildSaveFromMenu(info: Click, tab: Tab): { ok: true; input: SaveInput } | { ok: false; reason: string } {
  const pageUrl = info.pageUrl ?? tab?.url;
  const title = tab?.title ?? '';
  const priv = tab?.incognito === true;                      // trust the browser, not the page
  const base = { tags: [] as string[], remindAt: null, private: priv };

  if (info.menuItemId === MENU.page.id) {
    const target = info.linkUrl ?? pageUrl;                  // right-click on a link saves the link
    if (!isSavableUrl(target)) return { ok: false, reason: 'Bukmarkz can only save regular web pages (http or https).' };
    return { ok: true, input: { ...base, kind: 'page', url: target, title: info.linkUrl ? '' : title, note: '' } };
  }
  if (!isSavableUrl(pageUrl)) return { ok: false, reason: 'Bukmarkz can only save from regular web pages (http or https).' };

  if (info.menuItemId === MENU.selection.id) {
    const text = info.selectionText?.trim();
    if (!text) return { ok: false, reason: 'Select some text first.' };
    return { ok: true, input: { ...base, kind: 'selection', url: pageUrl, title, note: selectionNote(text, title, pageUrl) } };
  }
  if (info.menuItemId === MENU.image.id) {
    if (!isSavableUrl(info.srcUrl)) return { ok: false, reason: 'This image cannot be saved (it is embedded in the page, not a web address).' };
    return { ok: true, input: { ...base, kind: 'image', url: pageUrl, title, note: `![image](${mdUrl(info.srcUrl)})`, imageUrl: info.srcUrl } };
  }
  return { ok: false, reason: 'Unknown action.' };
}
