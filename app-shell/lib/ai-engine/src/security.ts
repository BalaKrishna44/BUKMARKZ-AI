/**
 * Everything the user saves (page text, OCR of a screenshot, a transcript) is attacker-controlled text: someone can
 * publish a page that says "ignore your instructions and ...". These helpers keep it in the DATA lane.
 */

/** JSON-encode untrusted data for a prompt. "<" is escaped so the text can never fake a closing </tag>. */
export function untrustedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function stripControl(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

export function oneLine(s: string): string {
  return stripControl(s).replace(/\s+/g, ' ').trim();
}

export function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

/** Clip to `max` characters on a word boundary and add an ellipsis. */
export function ellipsize(s: string, max: number): string {
  const t = oneLine(s);
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:!?-]+$/, '') + '…';
}

/** Keep the beginning and the end of a long text (the intro and the conclusion matter most). */
export function headTail(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const head = Math.floor(maxChars * 0.7);
  const tail = maxChars - head;
  return { text: `${text.slice(0, head)}\n[...]\n${text.slice(text.length - tail)}`, truncated: true };
}
