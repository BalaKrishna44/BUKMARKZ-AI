/** Split a note into pieces small enough to embed and to quote back, without cutting sentences in half. */

export interface ChunkOptions {
  maxChars?: number; //     default 1600 (about 400 tokens)
  overlapChars?: number; // default 200: the tail of one chunk is repeated at the start of the next
  minChars?: number; //     default 200: a smaller last piece is merged into the one before
}

function splitLong(paragraph: string, maxChars: number): string[] {
  const sentences = paragraph.split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (s.length > maxChars) {
      if (cur) out.push(cur), (cur = '');
      for (let i = 0; i < s.length; i += maxChars) out.push(s.slice(i, i + maxChars)); // one huge "sentence": cut by length
      continue;
    }
    if (cur && cur.length + s.length + 1 > maxChars) {
      out.push(cur);
      cur = s;
    } else {
      cur = cur ? `${cur} ${s}` : s;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function tailOnWordBoundary(s: string, n: number): string {
  if (s.length <= n) return s;
  const t = s.slice(s.length - n);
  const i = t.indexOf(' ');
  return i > 0 ? t.slice(i + 1) : t;
}

export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const maxChars = options.maxChars ?? 1600;
  const overlap = Math.min(options.overlapChars ?? 200, Math.floor(maxChars / 4));
  const minChars = options.minChars ?? 200;

  const normalized = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!normalized) return [];

  const pieces = normalized.split(/\n{2,}/).flatMap((p) => (p.length > maxChars ? splitLong(p, maxChars) : [p]));
  const chunks: string[] = [];
  let cur = '';
  for (const piece of pieces) {
    if (cur && cur.length + piece.length + 2 > maxChars) {
      chunks.push(cur);
      cur = `${tailOnWordBoundary(cur, overlap)}\n\n${piece}`.slice(-maxChars);
    } else {
      cur = cur ? `${cur}\n\n${piece}` : piece;
    }
  }
  if (cur) chunks.push(cur);

  if (chunks.length > 1) {
    const last = chunks[chunks.length - 1] as string;
    const prev = chunks[chunks.length - 2] as string;
    if (last.length < minChars && prev.length + last.length + 2 <= maxChars * 1.25) {
      chunks.splice(chunks.length - 2, 2, `${prev}\n\n${last}`);
    }
  }
  return chunks;
}

export interface BookmarkForIndex {
  title: string | null;
  url: string | null;
  platform: string | null;
  tags: string[];
  summary: string | null;
  note: string | null;
  contentText: string | null;
}

export const MAX_CHUNKS_PER_BOOKMARK = 60;

/**
 * Chunk 0 is a "header" built from title, platform, tags, summary, the user's own note and the site name. A question like
 * "that React UI library reel from Instagram" matches this chunk even when the body text never says "Instagram".
 */
export function buildBookmarkChunks(b: BookmarkForIndex): string[] {
  let host = '';
  try {
    host = b.url ? new URL(b.url).hostname.replace(/^www\./, '') : '';
  } catch {
    host = '';
  }
  const header = [
    b.title,
    b.platform ? `Saved from ${b.platform}${host && host !== b.platform ? ` (${host})` : ''}` : host ? `Saved from ${host}` : null,
    b.tags.length ? `Tags: ${b.tags.join(', ')}` : null,
    b.summary,
    b.note ? `My note: ${b.note}` : null,
  ]
    .filter((x): x is string => Boolean(x && x.trim()))
    .join('\n');

  const chunks = [...(header ? [header.slice(0, 1600)] : []), ...chunkText(b.contentText ?? '')];
  return chunks.slice(0, MAX_CHUNKS_PER_BOOKMARK);
}
