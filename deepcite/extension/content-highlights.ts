/**
 * OPTIONAL selection toolbar (a content script). Select text on a page and a small "Save highlight" button appears next to it.
 * It lives in a closed shadow root so page CSS cannot restyle it and page scripts cannot read it, it never reads the page
 * until you click, and it sends nothing anywhere itself: the click asks the background worker, which refuses incognito tabs.
 * Needs the content_scripts entry from README.md (http/https pages). Skip this file to ship the right-click path only.
 */
import { collectHighlight, HIGHLIGHT_MSG, type HighlightResult } from './highlights';

let host: HTMLElement | null = null;
const remove = () => { host?.remove(); host = null; };

function show(x: number, y: number) {
  remove();
  host = document.createElement('div');
  host.style.cssText = 'all:initial;position:absolute;z-index:2147483647;';
  host.style.left = `${Math.max(8, x + window.scrollX)}px`; host.style.top = `${y + window.scrollY + 8}px`;
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = 'button{font:600 12px system-ui,sans-serif;color:#eafff4;background:#0f6b3e;border:1px solid #34d399;border-radius:8px;padding:6px 10px;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.35)}button:hover{background:#12804b}button:focus-visible{outline:2px solid #a7f3d0}';
  const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Save highlight';
  b.addEventListener('mousedown', (e) => e.preventDefault());                      // keep the selection alive while clicking
  b.addEventListener('click', () => {
    const payload = collectHighlight();
    if (!payload) return remove();
    b.disabled = true; b.textContent = 'Saving…';
    chrome.runtime.sendMessage({ type: HIGHLIGHT_MSG, payload }, (r: HighlightResult | undefined) => {
      b.textContent = chrome.runtime.lastError || !r ? 'Could not save' : r.ok ? (r.duplicate ? 'Already saved' : 'Saved ✓') : r.error.slice(0, 60);
      setTimeout(remove, 1800);
    });
  });
  root.append(style, b);
  document.documentElement.appendChild(host);
}

document.addEventListener('mouseup', (e) => {
  if (host && e.composedPath().includes(host)) return;
  setTimeout(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.toString().replace(/\s+/g, ' ').trim().length < 3) return remove();
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return remove();
    show(rect.right, rect.bottom);
  }, 0);
}, true);
document.addEventListener('mousedown', (e) => { if (host && !e.composedPath().includes(host)) remove(); }, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') remove(); }, true);
document.addEventListener('scroll', remove, { passive: true, capture: true });
