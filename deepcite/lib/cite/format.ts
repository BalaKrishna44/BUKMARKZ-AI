/** Bibliography formatting: BibTeX, APA 7 (Markdown italics), CSL-JSON and a Markdown "quotes with deep links" notes file. Pure functions. */
import { buildFragmentUrl } from './fragment';

export interface CiteEntry {
  url: string; title: string | null; authors: string[]; published: string | null; container: string | null; publisher: string | null; doi: string | null;
  accessed: string;                                    // YYYY-MM-DD
}
export interface QuoteRow { quote: string; note: string | null; prefix: string | null; suffix: string | null; source_url: string }

// ---------- names ----------
export interface Name { family: string; given: string; literal?: string }
const SUFFIX = /^(?:jr|sr|ii|iii|iv)\.?$/i;
const PARTICLE = /^(?:van|von|de|der|den|di|da|del|della|la|le|du|bin|ibn|al|el|st\.?)$/i;
/** "Ada Lovelace" | "Lovelace, Ada" | "Ludwig van Beethoven" | "NASA" -> structured. A single token, or a name with digits or an org word, is kept literal. */
export function parseName(raw: string): Name {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (s.includes(',')) { const [family, ...rest] = s.split(','); return { family: family.trim(), given: rest.join(' ').trim() }; }
  const parts = s.split(' ');
  if (parts.length === 1 || /\d|\b(?:inc|ltd|llc|corp|company|university|institute|foundation|association|team|news|times|post|journal|magazine|blog)\b/i.test(s)) return { family: '', given: '', literal: s };
  while (parts.length > 2 && SUFFIX.test(parts[parts.length - 1])) parts.pop();
  let i = parts.length - 1;
  while (i > 1 && PARTICLE.test(parts[i - 1])) i--;
  return { family: parts.slice(i).join(' '), given: parts.slice(0, i).join(' ') };
}
const initials = (given: string) => given.split(/[\s-]+/).filter(Boolean).map((g) => g[0].toUpperCase() + '.').join(' ');

// ---------- dates ----------
const parts = (d: string | null) => { const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(d ?? ''); return m ? { y: +m[1], m: m[2] ? +m[2] : undefined, d: m[3] ? +m[3] : undefined } : null; };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ---------- keys ----------
const ascii = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]/g, '');
const STOP = new Set(['the', 'a', 'an', 'of', 'on', 'in', 'for', 'and', 'to', 'how', 'why', 'what', 'is']);
export function citeKeys(entries: CiteEntry[]): string[] {
  const used = new Map<string, number>();
  return entries.map((e) => {
    const n = e.authors[0] ? parseName(e.authors[0]) : null;
    const who = ascii(n?.family || n?.literal?.split(' ')[0] || (e.container ?? '') || new URL(e.url).hostname.replace(/^www\./, '').split('.')[0]).toLowerCase() || 'source';
    const word = ascii((e.title ?? '').split(/\s+/).find((w) => w.length > 2 && !STOP.has(w.toLowerCase())) ?? '').toLowerCase();
    const base = `${who}${parts(e.published)?.y ?? ''}${word}`;
    const c = (used.get(base) ?? 0) + 1; used.set(base, c);
    return c === 1 ? base : `${base}${String.fromCharCode(95 + Math.min(c, 26))}${c > 26 ? c : ''}`;
  });
}

/** A DOI plus a container (journal title or site name) is treated as an article; everything else is a web page. */
const isJournal = (e: CiteEntry) => !!(e.doi && e.container);

// ---------- BibTeX ----------
const tex = (s: string) => s.replace(/\\/g, '\\textbackslash{}').replace(/([{}&%$#_])/g, '\\$1').replace(/\^/g, '\\textasciicircum{}').replace(/~/g, '\\textasciitilde{}');
/** URLs go in unescaped (biblatex/hyperref handle % # & _); only braces and backslashes would break the entry, so they are percent-encoded. */
const texUrl = (s: string) => s.replace(/[{}\\]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
export function toBibtex(entries: CiteEntry[]): string {
  const keys = citeKeys(entries);
  return entries.map((e, i) => {
    const p = parts(e.published);
    const au = e.authors.map((a) => { const n = parseName(a); return n.literal ? `{${tex(n.literal)}}` : `${tex(n.family)}, ${tex(n.given)}`; }).join(' and ');
    const type = isJournal(e) ? 'article' : 'misc';
    const f: [string, string | null][] = [
      ['author', au || null], ['title', e.title ? `{${tex(e.title)}}` : null],            // double braces keep the capitalisation
      [type === 'article' ? 'journal' : 'howpublished', e.container ? tex(e.container) : null],
      ['publisher', e.publisher ? tex(e.publisher) : null],
      ['year', p ? String(p.y) : null], ['month', p?.m ? String(p.m) : null], ['doi', e.doi],
      ['url', texUrl(e.url)], ['note', `Accessed ${e.accessed}`],
    ];
    const body = f.filter(([, v]) => v).map(([k, v]) => `  ${k} = ${k === 'month' || k === 'year' ? v : `{${v}}`}`);
    return `@${type}{${keys[i]},\n${body.join(',\n')}\n}`;
  }).join('\n\n') + (entries.length ? '\n' : '');
}

// ---------- APA 7 (Markdown: *italics*) ----------
const apaAuthor = (names: string[]): string => {
  const f = names.map((a) => { const n = parseName(a); return n.literal ?? `${n.family}, ${initials(n.given)}`.replace(/, $/, ''); });
  if (f.length === 0) return '';
  if (f.length === 1) return f[0];
  if (f.length <= 20) return f.slice(0, -1).join(', ') + ', & ' + f[f.length - 1];
  return f.slice(0, 19).join(', ') + ', . . . ' + f[f.length - 1];
};
export function toApa(entries: CiteEntry[]): string {
  const rows = entries.map((e) => {
    const p = parts(e.published);
    const date = p ? `(${p.y}${p.m ? `, ${MONTHS[p.m - 1]}${p.d ? ' ' + p.d : ''}` : ''})` : '(n.d.)';
    const who = apaAuthor(e.authors);
    const title = e.title ?? e.url;
    const end = (s: string) => (/[.?!]$/.test(s) ? s : s + '.');
    const link = e.doi ? `https://doi.org/${e.doi}` : e.url;
    const site = e.container && e.container !== who ? ` ${end(e.container)}` : '';
    const lead = who ? `${end(who)} ${date}.` : `${end(title)} ${date}.`;
    const italic = `*${title.replace(/[.?!]$/, (c) => '')}*${/[.?!]$/.test(title) ? title.slice(-1) : '.'}`;      // the closing period is not italic
    return { sort: (who || title).toLowerCase(), text: who ? `${lead} ${italic}${site} ${link}` : `${lead}${site} ${link}` };
  });
  return rows.sort((a, b) => a.sort.localeCompare(b.sort)).map((r) => r.text).join('\n\n') + (rows.length ? '\n' : '');
}

// ---------- CSL-JSON ----------
export function toCsl(entries: CiteEntry[]): string {
  const keys = citeKeys(entries);
  const out = entries.map((e, i) => {
    const p = parts(e.published), a = parts(e.accessed);
    const journal = isJournal(e);
    return {
      id: keys[i], type: journal ? 'article-journal' : 'webpage',
      ...(e.title ? { title: e.title } : {}),
      ...(e.authors.length ? { author: e.authors.map((n) => { const x = parseName(n); return x.literal ? { literal: x.literal } : { family: x.family, given: x.given }; }) } : {}),
      ...(p ? { issued: { 'date-parts': [[p.y, ...(p.m ? [p.m] : []), ...(p.d ? [p.d] : [])]] } } : {}),
      ...(e.container ? { 'container-title': e.container } : {}), ...(e.publisher ? { publisher: e.publisher } : {}),
      ...(e.doi ? { DOI: e.doi } : {}), URL: e.url,
      ...(a ? { accessed: { 'date-parts': [[a.y, a.m!, a.d!]] } } : {}),
    };
  });
  return JSON.stringify(out, null, 2) + '\n';
}

// ---------- Markdown notes: quotes with deep links, grouped by source ----------
const mdEsc = (s: string) => s.replace(/([\\`*_[\]<>])/g, '\\$1');
export function toMarkdownNotes(groups: { entry: CiteEntry; quotes: QuoteRow[] }[]): string {
  return groups.map(({ entry, quotes }) => {
    const p = parts(entry.published);
    const meta = [entry.authors.length ? entry.authors.join(', ') : '', entry.container ?? '', p ? String(p.y) : ''].filter(Boolean).map(mdEsc).join(' · ');
    const head = `## [${mdEsc(entry.title ?? entry.url)}](<${entry.url}>)${meta ? `\n${meta}` : ''}`;
    const body = quotes.map((q) => {
      const link = buildFragmentUrl(q.source_url, q.quote, q) ?? q.source_url;
      return `> ${mdEsc(q.quote)} [↗](<${link}>)${q.note ? `\n\n${mdEsc(q.note)}` : ''}`;
    }).join('\n\n');
    return `${head}\n\n${body}`;
  }).join('\n\n') + (groups.length ? '\n' : '');
}
