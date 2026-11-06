/**
 * Text-fragment deep links ("scroll to text"): https://example.com/page#:~:text=prefix-,start,end,-suffix
 * Pure string code, no DOM and no Node APIs. The same module runs in the API, in tests and in the dashboard.
 *
 * Rules from the spec that matter here:
 *  - `-` `,` `&` are delimiters and must be percent-encoded inside a term (encodeURIComponent leaves `-` alone).
 *  - A term cannot span two blocks (paragraphs, list items). A quote that does is written as `start,end` so the browser matches the
 *    first words and the last words instead of one exact string.
 *  - An existing normal fragment (#section) is kept: the directive goes after `:~:`.
 */

const WORDS_EDGE = 5;          // words used at each end of a long or multi-block quote
const LONG_QUOTE = 300;        // characters; longer quotes use the start,end form
const SHORT_QUOTE = 40;        // characters; shorter quotes get prefix/suffix context so the right occurrence is found

const enc = (s: string) => encodeURIComponent(s).replace(/-/g, '%2D').replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Last `n` words of a string / first `n` words. */
const tail = (s: string, n: number) => squash(s).split(' ').slice(-n).join(' ');
const head = (s: string, n: number) => squash(s).split(' ').slice(0, n).join(' ');

/** Returns the deep link, or null when `url` is not a plain http(s) address or the quote is too short to match reliably. */
export function buildFragmentUrl(url: string, quote: string, ctx: { prefix?: string | null; suffix?: string | null } = {}): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const flat = squash(quote);
  if (flat.length < 3) return null;

  const blocks = quote.split(/\n\s*\n|\r?\n/).map(squash).filter(Boolean);      // paragraph boundaries inside the selection
  let directive: string;
  if (blocks.length > 1 || flat.length > LONG_QUOTE) {
    const first = blocks.length > 1 ? blocks[0] : flat, last = blocks.length > 1 ? blocks[blocks.length - 1] : flat;
    const start = head(first, WORDS_EDGE), end = tail(last, WORDS_EDGE);
    directive = start && end && (blocks.length > 1 || start !== end) ? `${enc(start)},${enc(end)}` : enc(flat);
  } else {
    directive = enc(flat);
  }
  const prefix = squash(ctx.prefix ?? ''), suffix = squash(ctx.suffix ?? '');
  if (flat.length < SHORT_QUOTE && !directive.includes(',')) {
    if (prefix) directive = `${enc(tail(prefix, 3))}-,${directive}`;
    if (suffix) directive = `${directive},-${enc(head(suffix, 3))}`;
  }

  // Keep a real fragment (#section) and drop any directive that is already there.
  const hash = u.hash.replace(/^#/, '');
  const existing = hash.split(':~:')[0];
  u.hash = '';
  const base = u.toString().replace(/#$/, '');
  return `${base}#${existing}:~:text=${directive}`;
}
