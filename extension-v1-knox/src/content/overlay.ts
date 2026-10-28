/**
 * In-page save widget. Injected on demand (Cmd/Ctrl+Shift+S) with chrome.scripting + activeTab,
 * so the extension needs no permission to read every site. Lives in a closed shadow root so the
 * page cannot style it or read what the user types.
 */
import { LIMITS } from '../shared/config';
import { send } from '../shared/messages';
import { cleanTag } from '../shared/validate';
import { reminderPresets } from '../shared/reminders';

const GUARD = '__bukmarkzOverlay__';
const w = window as unknown as Record<string, { toggle(): void } | undefined>;

const CSS = `
:host{all:initial}
*{box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:flex-start;justify-content:flex-end;padding:16px;pointer-events:none}
.card{pointer-events:auto;width:min(380px,calc(100vw - 32px));background:#0b1020;color:#e8ecf5;border:1px solid #243052;border-radius:16px;box-shadow:0 20px 50px rgba(0,0,0,.45);padding:14px;font-size:13px;line-height:1.4;animation:in .14s ease-out}
@media (prefers-reduced-motion:reduce){.card{animation:none}}
@keyframes in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
.head{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.logo{width:24px;height:24px;border-radius:7px;background:#fca311;display:grid;place-items:center}
.logo svg{width:13px;height:13px}
.brand{font-weight:700;font-size:14px}.brand b{color:#fca311}
.priv{margin-left:auto;font-size:11px;background:#2a1f4d;color:#cdb8ff;border-radius:999px;padding:2px 8px}
.x{margin-left:auto;background:none;border:0;color:#8a95b3;font-size:18px;cursor:pointer;border-radius:8px;padding:0 6px}
.priv+.x{margin-left:6px}
.x:hover,.x:focus-visible{color:#fff;outline:2px solid #fca311}
label{display:block;font-size:11px;color:#8a95b3;margin:10px 0 4px}
input,textarea,select{width:100%;background:#121a33;color:#e8ecf5;border:1px solid #243052;border-radius:10px;padding:8px 10px;font-size:13px}
input:focus,textarea:focus,select:focus{outline:2px solid #fca311;outline-offset:0;border-color:#fca311}
textarea{min-height:70px;resize:vertical}
.url{color:#8a95b3;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:4px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.chip{display:inline-flex;align-items:center;gap:4px;background:#1b2547;border:1px solid #2c3a69;color:#dfe6ff;border-radius:999px;padding:2px 8px;font-size:12px;cursor:pointer}
.chip.on{background:#fca311;border-color:#fca311;color:#14213d;font-weight:600}
.row{display:flex;gap:8px;margin-top:14px;align-items:center}
.save{flex:1;background:#fca311;color:#14213d;border:0;border-radius:10px;padding:9px 12px;font-weight:700;font-size:13px;cursor:pointer}
.save:hover{background:#ffb23e}.save:disabled{opacity:.6;cursor:wait}
.save:focus-visible{outline:2px solid #fff;outline-offset:2px}
.hint{font-size:11px;color:#6f7a99}
.msg{margin-top:10px;font-size:12px;border-radius:8px;padding:8px 10px}
.msg.err{background:#3a1620;color:#ffb4b4}.msg.ok{background:#12301f;color:#a8f0c0}
a{color:#fca311}
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text; // textContent only: page and note text are never parsed as HTML
  return e;
}

function build() {
  const host = el('div');
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'closed' });
  root.appendChild(el('style', {}, CSS));

  const wrap = el('div', { class: 'wrap' });
  const card = el('div', { class: 'card', role: 'dialog', 'aria-modal': 'false', 'aria-label': 'Save to Bukmarkz' });
  wrap.appendChild(card);
  root.appendChild(wrap);

  const incognito = chrome.extension?.inIncognitoContext === true;
  const tags = new Set<string>();
  let history: string[] = [];

  // header
  const head = el('div', { class: 'head' });
  const logo = el('div', { class: 'logo' });
  logo.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#14213d" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>'; // static string, no page data
  const brand = el('div', { class: 'brand' });
  brand.append('Bukmarkz ', el('b', {}, 'AI'));
  head.append(logo, brand);
  if (incognito) head.appendChild(el('span', { class: 'priv', title: 'Saved only on this device' }, 'Private'));
  const close = el('button', { class: 'x', 'aria-label': 'Close', type: 'button' }, '×');
  head.appendChild(close);

  // fields
  const titleId = 'bk-title', noteId = 'bk-note', tagId = 'bk-tag', remId = 'bk-rem';
  const title = el('input', { id: titleId, type: 'text', maxlength: String(LIMITS.title) });
  title.value = document.title.trim().slice(0, LIMITS.title);
  const url = el('div', { class: 'url' }, location.href);

  const note = el('textarea', { id: noteId, maxlength: String(LIMITS.note), placeholder: 'Why does this matter? Markdown works: **bold**, - lists, [links](url)' });
  const sel = window.getSelection()?.toString().trim();
  if (sel) note.value = `> ${sel.slice(0, 500)}\n\n`;

  const tagInput = el('input', { id: tagId, type: 'text', placeholder: 'Add a tag, press Enter', maxlength: String(LIMITS.tag) });
  const chips = el('div', { class: 'chips', 'aria-label': 'Tags' });

  const reminder = el('select', { id: remId });
  const presets = reminderPresets();
  for (const p of presets) reminder.appendChild(el('option', { value: p.id }, p.label));

  const status = el('div', { 'aria-live': 'polite' });
  const saveBtn = el('button', { class: 'save', type: 'button' }, 'Save');
  const hint = el('span', { class: 'hint' }, (navigator.platform.includes('Mac') ? '⌘' : 'Ctrl') + '+Enter to save · Esc to close');
  const row = el('div', { class: 'row' });
  row.append(saveBtn);

  const lbl = (f: string, t: string) => el('label', { for: f }, t);
  card.append(head, lbl(titleId, 'Title'), title, url, lbl(noteId, 'Note'), note, lbl(tagId, 'Tags'), tagInput, chips, lbl(remId, 'Remind me'), reminder, row, el('div', { style: 'margin-top:8px' }), hint, status);

  function drawChips() {
    chips.textContent = '';
    const shown = [...new Set([...tags, ...history])].slice(0, 12);
    for (const t of shown) {
      const c = el('button', { class: 'chip' + (tags.has(t) ? ' on' : ''), type: 'button', 'aria-pressed': String(tags.has(t)) }, '#' + t);
      c.addEventListener('click', () => { tags.has(t) ? tags.delete(t) : tags.size < LIMITS.tags && tags.add(t); drawChips(); });
      chips.appendChild(c);
    }
  }

  function addTagFromInput() {
    const t = cleanTag(tagInput.value);
    if (t && tags.size < LIMITS.tags) tags.add(t);
    tagInput.value = '';
    drawChips();
  }
  tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTagFromInput(); }
    else if (e.key === 'Backspace' && !tagInput.value && tags.size) { tags.delete([...tags].pop() as string); drawChips(); }
  });

  function message(kind: 'err' | 'ok', text: string, link?: boolean) {
    status.textContent = '';
    const m = el('div', { class: `msg ${kind}`, role: kind === 'err' ? 'alert' : 'status' }, text);
    if (link) m.append(' ', el('a', { href: 'https://www.bukmarkz.com/', target: '_blank', rel: 'noopener noreferrer' }, 'Open Bukmarkz'));
    status.appendChild(m);
  }

  async function doSave() {
    if (saveBtn.disabled) return;
    addTagFromInput();
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    const preset = presets.find((p) => p.id === reminder.value);
    try {
      const res = await send({ type: 'save', input: { url: location.href, title: title.value, note: note.value, tags: [...tags], remindAt: preset?.at ?? null, private: incognito } });
      if (res.ok) {
        const st = res.item?.status;
        message('ok', st === 'local-private' ? 'Saved privately on this device.' : st === 'queued' ? 'Saved. Will sync when you are back online.' : 'Saved to Bukmarkz.');
        setTimeout(api.close, 1200);
      } else {
        message('err', res.error, res.code === 'not_signed_in' || res.code === 'invalid_token');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
      }
    } catch {
      message('err', 'The extension was updated. Reload this page and try again.');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  }

  saveBtn.addEventListener('click', () => void doSave());
  close.addEventListener('click', () => api.close());
  // Keep the page's own shortcuts (j/k, /, etc.) from firing while the user types here.
  for (const type of ['keydown', 'keyup', 'keypress'] as const) {
    card.addEventListener(type, (e) => {
      e.stopPropagation();
      if (type === 'keydown') {
        const k = e as KeyboardEvent;
        if (k.key === 'Escape') api.close();
        if (k.key === 'Enter' && (k.metaKey || k.ctrlKey)) { k.preventDefault(); void doSave(); }
      }
    });
  }

  void send({ type: 'tags:get' }).then((r) => { if (r.ok && r.tags) { history = r.tags; drawChips(); } }).catch(() => undefined);
  drawChips();

  const previouslyFocused = document.activeElement as HTMLElement | null;
  const api = {
    host,
    open() { document.documentElement.appendChild(host); setTimeout(() => (note.value ? note : title).focus(), 0); },
    close() { host.remove(); previouslyFocused?.focus?.(); delete w[GUARD]; },
    toggle() { this.close(); },
  };
  return api;
}

if (w[GUARD]) {
  w[GUARD]!.toggle(); // pressing the shortcut again closes it
} else {
  const overlay = build();
  w[GUARD] = overlay;
  overlay.open();
}
