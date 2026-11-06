/**
 * Turns raw page metadata into one clean citation record. The extension only collects strings
 * (`collectMetaInPage`, see extension/highlights.ts); everything here runs on the server and treats them as untrusted text.
 * Order of trust: Highwire `citation_*` tags (scholarly) > JSON-LD > Dublin Core > OpenGraph / article:* > plain `author` / <title>.
 */
export interface RawPageMeta { url: string; title: string; metas: [string, string][]; ld: string[] }
export interface CiteMeta { title: string | null; authors: string[]; published: string | null; container: string | null; publisher: string | null; doi: string | null }

export const MAX_RAW_METAS = 200, MAX_RAW_LD = 5, MAX_LD_CHARS = 100_000;

const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v : '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** "2024-05-03T10:00:00Z", "2024/05/03", "May 3, 2024", "2024" -> "2024-05-03" | "2024-05" | "2024" | null. Rejects impossible dates. */
export function normalizeDate(raw: unknown): string | null {
  const s = clean(raw, 60);
  if (!s) return null;
  const valid = (y: number, m?: number, d?: number) => {
    if (y < 1000 || y > new Date().getUTCFullYear() + 1) return null;
    if (m === undefined) return String(y);
    if (m < 1 || m > 12) return null;
    if (d === undefined) return `${y}-${String(m).padStart(2, '0')}`;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  let m = /^(\d{4})(?:[-/.](\d{1,2})(?:[-/.](\d{1,2}))?)?(?:[T\s].*)?$/.exec(s);
  if (m) return valid(+m[1], m[2] ? +m[2] : undefined, m[3] ? +m[3] : undefined);
  const t = Date.parse(s.length > 40 ? '' : s + (/[a-z]/i.test(s) && !/\d{4}/.test(s) ? '' : ' UTC'));
  if (!Number.isNaN(t)) { const d = new Date(t); return valid(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
  m = /(\d{4})/.exec(s);
  return m ? valid(+m[1]) : null;
}

/** Bare DOI from "10.1234/x", "doi:10.1234/x", "https://doi.org/10.1234/x". */
export function normalizeDoi(raw: unknown): string | null {
  const s = clean(raw, 300).replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '');
  return /^10\.\d{4,9}\/\S{1,200}$/.test(s) ? s : null;
}

const NOT_A_PERSON = /^(?:admin|administrator|staff|editor|editors|the team|team|unknown|anonymous|n\/a|none|null|undefined|\[object object\])$/i;
/** Cleans one name; drops URLs, handles, emails and placeholder values. "Lovelace, Ada" is kept as given (formatters handle both orders). */
export function cleanAuthor(raw: unknown): string | null {
  const s = clean(raw, 120).replace(/^by\s+/i, '');
  if (s.length < 2 || NOT_A_PERSON.test(s) || /https?:|@|\/\//.test(s) || /^\d+$/.test(s)) return null;
  return s;
}
function addAuthors(into: string[], raw: unknown) {
  if (Array.isArray(raw)) { raw.forEach((r) => addAuthors(into, r)); return; }
  if (raw && typeof raw === 'object') { addAuthors(into, (raw as { name?: unknown }).name); return; }
  if (typeof raw !== 'string') return;
  // "A, B and C" lists are split; "Lovelace, Ada" (one comma, two short words) is a single inverted name.
  const s = clean(raw, 400);
  const parts = /;|\s+and\s+|\s+&\s+/i.test(s) ? s.split(/;|\s+and\s+|\s+&\s+/i) : (s.match(/,/g)?.length ?? 0) >= 2 ? s.split(',') : [s];
  for (const p of parts) { const a = cleanAuthor(p); if (a && !into.some((x) => x.toLowerCase() === a.toLowerCase())) into.push(a); }
}

type Obj = Record<string, unknown>;
const ARTICLE = /^(?:Article|NewsArticle|BlogPosting|ScholarlyArticle|TechArticle|Report|WebPage|CreativeWork|LiveBlogPosting|OpinionNewsArticle|AnalysisNewsArticle)$/;
function* ldNodes(v: unknown, depth = 0): Generator<Obj> {
  if (depth > 4 || !v) return;
  if (Array.isArray(v)) { for (const x of v.slice(0, 50)) yield* ldNodes(x, depth + 1); return; }
  if (typeof v === 'object') { const o = v as Obj; yield o; if (o['@graph']) yield* ldNodes(o['@graph'], depth + 1); }
}
const typeOf = (o: Obj): string[] => (Array.isArray(o['@type']) ? o['@type'] : [o['@type']]).filter((t): t is string => typeof t === 'string');

export function normalizeMeta(raw: RawPageMeta): CiteMeta {
  const get = new Map<string, string[]>();
  for (const [k, v] of raw.metas.slice(0, MAX_RAW_METAS)) {
    const key = clean(k, 80).toLowerCase(), val = clean(v, 500);
    if (key && val) get.set(key, [...(get.get(key) ?? []), val]);
  }
  const first = (...keys: string[]) => { for (const k of keys) { const v = get.get(k)?.[0]; if (v) return v; } return null; };
  const all = (...keys: string[]) => keys.flatMap((k) => get.get(k) ?? []);

  // JSON-LD (first article-like node wins)
  let ld: Obj | null = null;
  for (const text of raw.ld.slice(0, MAX_RAW_LD)) {
    if (text.length > MAX_LD_CHARS) continue;
    let parsed: unknown; try { parsed = JSON.parse(text); } catch { continue; }
    for (const n of ldNodes(parsed)) if (typeOf(n).some((t) => ARTICLE.test(t)) && (n.headline || n.name || n.author || n.datePublished)) { ld = n; break; }
    if (ld) break;
  }

  const authors: string[] = [];
  addAuthors(authors, all('citation_author'));
  if (!authors.length && ld) addAuthors(authors, ld.author);
  if (!authors.length) addAuthors(authors, all('dc.creator', 'dc.contributor', 'article:author', 'og:article:author', 'author', 'parsely-author', 'twitter:creator'));

  const ldPublisher = ld && (typeof ld.publisher === 'string' ? ld.publisher : (ld.publisher as Obj | undefined)?.name);
  const isPartOf = ld && (ld.isPartOf as Obj | undefined)?.name;
  const published = normalizeDate(first('citation_publication_date', 'citation_date', 'citation_online_date')) ?? normalizeDate(ld?.datePublished)
    ?? normalizeDate(first('dc.date', 'dc.date.issued', 'article:published_time', 'og:article:published_time', 'date', 'pubdate', 'parsely-pub-date')) ?? normalizeDate(ld?.dateCreated);
  const doi = normalizeDoi(first('citation_doi', 'dc.identifier.doi')) ?? normalizeDoi(ld?.doi) ?? normalizeDoi(typeof ld?.identifier === 'string' ? ld.identifier : (ld?.identifier as Obj | undefined)?.value)
    ?? normalizeDoi(all('dc.identifier').find((v) => /10\.\d{4,9}\//.test(v)));
  const journal = first('citation_journal_title', 'citation_conference_title', 'prism.publicationname');

  const title = clean(first('citation_title', 'dc.title') ?? (typeof ld?.headline === 'string' ? ld.headline : typeof ld?.name === 'string' ? ld.name : null) ?? first('og:title', 'twitter:title') ?? raw.title, 300) || null;
  return {
    title,
    authors: authors.slice(0, 30),
    published,
    container: clean(journal ?? first('og:site_name', 'application-name') ?? (typeof isPartOf === 'string' ? isPartOf : '') ?? '', 200) || null,
    publisher: clean(first('citation_publisher', 'dc.publisher') ?? (typeof ldPublisher === 'string' ? ldPublisher : ''), 200) || null,
    doi,
  };
}
