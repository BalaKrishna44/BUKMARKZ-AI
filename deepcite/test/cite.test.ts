import { buildFragmentUrl } from '../lib/cite/fragment';
import { normalizeDate, normalizeDoi, normalizeMeta, cleanAuthor } from '../lib/cite/meta';
import { parseName, citeKeys, toBibtex, toApa, toCsl, toMarkdownNotes, type CiteEntry } from '../lib/cite/format';

let fails = 0, n = 0;
const eq = (a: unknown, b: unknown, m: string) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) { fails++; console.log('FAIL', m, '\n  got ', JSON.stringify(a), '\n  want', JSON.stringify(b)); } };
const ok = (c: boolean, m: string) => eq(c, true, m);

// ---- fragments
eq(buildFragmentUrl('https://example.com/a', 'The quick brown fox jumps over the lazy dog'), 'https://example.com/a#:~:text=The%20quick%20brown%20fox%20jumps%20over%20the%20lazy%20dog', 'plain quote is one encoded term');
eq(buildFragmentUrl('https://e.com/p', 'state-of-the-art, fast & small'), 'https://e.com/p#:~:text=state%2Dof%2Dthe%2Dart%2C%20fast%20%26%20small', 'dash, comma and ampersand are encoded');
eq(buildFragmentUrl('https://e.com/p#intro', 'hello world quote'), 'https://e.com/p#intro:~:text=hello%20world%20quote', 'existing #section is kept');
eq(buildFragmentUrl('https://e.com/p#sec:~:text=zzz', 'hello world quote'), 'https://e.com/p#sec:~:text=hello%20world%20quote', 'an existing directive is replaced (section kept)');
eq(buildFragmentUrl('https://e.com/p', 'first paragraph words here and more\n\nsecond paragraph ends right here today'), 'https://e.com/p#:~:text=first%20paragraph%20words%20here%20and,paragraph%20ends%20right%20here%20today', 'multi-paragraph selection -> start,end with 5 words each');
eq(buildFragmentUrl('https://e.com/p', 'short quote', { prefix: 'a b c d before', suffix: 'after x y z' }), 'https://e.com/p#:~:text=c%20d%20before-,short%20quote,-after%20x%20y', 'short quote gets 3 words of prefix/suffix context');
eq(buildFragmentUrl('https://e.com/p', 'a quote that is comfortably longer than forty characters in total', { prefix: 'before', suffix: 'after' }), 'https://e.com/p#:~:text=a%20quote%20that%20is%20comfortably%20longer%20than%20forty%20characters%20in%20total', 'longer quotes need no context');
const long = Array.from({ length: 80 }, (_, i) => 'word' + i).join(' ');
eq(buildFragmentUrl('https://e.com/p', long), 'https://e.com/p#:~:text=word0%20word1%20word2%20word3%20word4,word75%20word76%20word77%20word78%20word79', 'over 300 chars -> first 5 and last 5 words');
eq(buildFragmentUrl('javascript:alert(1)', 'abcdef'), null, 'non-http rejected');
eq(buildFragmentUrl('not a url', 'abcdef'), null, 'garbage url rejected');
eq(buildFragmentUrl('https://e.com/p', '  '), null, 'blank quote rejected');
eq(buildFragmentUrl('https://e.com/p', "it's (really) *fine*!"), 'https://e.com/p#:~:text=it%27s%20%28really%29%20%2Afine%2A%21', "' ( ) * ! are percent-encoded too");

// ---- dates / doi / authors
eq(normalizeDate('2024-05-03T10:00:00Z'), '2024-05-03', 'ISO datetime');
eq(normalizeDate('2024/5/3'), '2024-05-03', 'slashes');
eq(normalizeDate('2024-05'), '2024-05', 'year-month');
eq(normalizeDate('2024'), '2024', 'year');
eq(normalizeDate('May 3, 2024'), '2024-05-03', 'long form');
eq(normalizeDate('2023-02-30'), null, 'impossible date');
eq(normalizeDate('0099-01-01'), null, 'implausible year');
eq(normalizeDate('2999-01-01'), null, 'future year');
eq(normalizeDate('last tuesday'), null, 'words');
eq(normalizeDoi('https://doi.org/10.1234/ABC.5'), '10.1234/ABC.5', 'doi url');
eq(normalizeDoi('doi: 10.1234/x'), '10.1234/x', 'doi prefix');
eq(normalizeDoi('10.12/x'), null, 'short registrant');
eq(cleanAuthor('By Jane Doe'), 'Jane Doe', '"By" stripped');
eq(cleanAuthor('https://twitter.com/jane'), null, 'url is not an author');
eq(cleanAuthor('admin'), null, 'placeholder dropped');
eq(cleanAuthor('@jane'), null, 'handle dropped');

// ---- metadata
const scholarly = normalizeMeta({ url: 'https://j.org/x', title: 'tab title', ld: [], metas: [['citation_title', 'Attention Is All You Need'], ['citation_author', 'Vaswani, Ashish'], ['citation_author', 'Shazeer, Noam'], ['citation_publication_date', '2017/06/12'], ['citation_journal_title', 'NeurIPS'], ['citation_doi', '10.5555/3295222.3295349'], ['og:title', 'ignored']] });
eq(scholarly, { title: 'Attention Is All You Need', authors: ['Vaswani, Ashish', 'Shazeer, Noam'], published: '2017-06-12', container: 'NeurIPS', publisher: null, doi: '10.5555/3295222.3295349' }, 'Highwire tags win');
const ld = normalizeMeta({ url: 'https://n.com/a', title: 'T', metas: [['og:site_name', 'The Daily'], ['author', 'wrong author']], ld: [JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebSite', name: 'The Daily' }, { '@type': 'NewsArticle', headline: 'Big News', author: [{ '@type': 'Person', name: 'Ann Lee' }, { name: 'Bo Chan' }], datePublished: '2022-01-02T03:04:05+00:00', publisher: { name: 'Daily Corp' } }] })] });
eq(ld, { title: 'Big News', authors: ['Ann Lee', 'Bo Chan'], published: '2022-01-02', container: 'The Daily', publisher: 'Daily Corp', doi: null }, 'JSON-LD @graph article beats plain author tag');
eq(normalizeMeta({ url: 'https://x.com', title: 'Plain Page', metas: [['article:published_time', '2021-07-04T00:00:00Z'], ['article:author', 'https://facebook.com/someone'], ['author', 'Sam Roe and Pat Kim']], ld: [] }),
  { title: 'Plain Page', authors: ['Sam Roe', 'Pat Kim'], published: '2021-07-04', container: null, publisher: null, doi: null }, 'OpenGraph fallbacks; profile URL author skipped; "and" splits');
eq(normalizeMeta({ url: 'https://x.com', title: 'x', metas: [], ld: ['{not json', JSON.stringify({ '@type': 'Product', name: 'Shoe' })] }).authors, [], 'bad / irrelevant JSON-LD ignored');
eq(normalizeMeta({ url: 'https://x.com', title: 'x', metas: [['author', 'Doe, Jane']], ld: [] }).authors, ['Doe, Jane'], 'inverted single name kept whole');
eq(normalizeMeta({ url: 'https://x.com', title: 'x', metas: [['author', 'A One, B Two, C Three']], ld: [] }).authors, ['A One', 'B Two', 'C Three'], 'comma list split');
eq(normalizeMeta({ url: 'https://x.com', title: '<script>alert(1)</script>\u0000 Hi', metas: [], ld: [] }).title, '<script>alert(1)</script> Hi', 'control chars stripped; markup is left as text (rendered escaped)');
eq(normalizeMeta({ url: 'https://x.com', title: 'x'.repeat(5000), metas: [['citation_author', 'z'.repeat(500)]], ld: [] }).title?.length, 300, 'title capped');

// ---- names
eq(parseName('Ada Lovelace'), { family: 'Lovelace', given: 'Ada' }, 'first last');
eq(parseName('Lovelace, Ada'), { family: 'Lovelace', given: 'Ada' }, 'last, first');
eq(parseName('Ludwig van Beethoven'), { family: 'van Beethoven', given: 'Ludwig' }, 'particle stays with the family name');
eq(parseName('Martin Luther King Jr.'), { family: 'King', given: 'Martin Luther' }, 'suffix dropped');
eq(parseName('NASA'), { family: '', given: '', literal: 'NASA' }, 'single token is literal');
eq(parseName('The New York Times'), { family: '', given: '', literal: 'The New York Times' }, 'organisation is literal');

// ---- formats
const e1: CiteEntry = { url: 'https://j.org/x', title: 'Attention Is All You Need', authors: ['Vaswani, Ashish', 'Noam Shazeer'], published: '2017-06-12', container: 'NeurIPS', publisher: null, doi: '10.5555/3295222.3295349', accessed: '2026-10-28' };
const e2: CiteEntry = { url: 'https://blog.dev/post?a=1&b=2#x', title: 'R&D at 100% {fast} #1_ok', authors: [], published: null, container: 'Dev Blog', publisher: null, doi: null, accessed: '2026-10-28' };
const e3: CiteEntry = { ...e1, url: 'https://j.org/y', title: 'Attention Revisited' };
eq(citeKeys([e1, e3, e2]), ['vaswani2017attention', 'vaswani2017attentiona', 'devblogrd'], 'keys: author+year+first word, collisions get a letter, no-author falls back to the site');
const bib = toBibtex([e1, e2]);
ok(bib.includes('@article{vaswani2017attention,') && bib.includes('author = {Vaswani, Ashish and Shazeer, Noam}') && bib.includes('journal = {NeurIPS}') && bib.includes('doi = {10.5555/3295222.3295349}'), 'BibTeX article');
ok(bib.includes('@misc{devblogrd,') && bib.includes('title = {{R\\&D at 100\\% \\{fast\\} \\#1\\_ok}}') && bib.includes('howpublished = {Dev Blog}'), 'BibTeX escapes & % { } # _ and keeps case with double braces');
ok(bib.includes('url = {https://blog.dev/post?a=1&b=2#x}'), 'BibTeX url left intact');
ok(!/author =/.test(bib.split('@misc')[1]), 'no empty author field');
ok(bib.includes('year = 2017') && bib.includes('month = 6'), 'BibTeX year/month');
const apa = toApa([e2, e1]);
eq(apa.split('\n\n')[1].trim(), 'Vaswani, A., & Shazeer, N. (2017, June 12). *Attention Is All You Need*. NeurIPS. https://doi.org/10.5555/3295222.3295349', 'APA with authors, date, DOI link');
ok(apa.split('\n\n')[0].startsWith('R&D at 100% {fast} #1_ok. (n.d.).'), 'APA without author: title first, n.d., sorted alphabetically');
const csl = JSON.parse(toCsl([e1, e2]));
eq(csl[0].type, 'article-journal', 'CSL journal type'); eq(csl[0].author[0], { family: 'Vaswani', given: 'Ashish' }, 'CSL author'); eq(csl[0].issued, { 'date-parts': [[2017, 6, 12]] }, 'CSL date');
eq(csl[1].type, 'webpage', 'CSL webpage'); eq('author' in csl[1] || 'issued' in csl[1], false, 'CSL omits empty fields'); eq(csl[1].accessed, { 'date-parts': [[2026, 10, 28]] }, 'CSL accessed');
const md = toMarkdownNotes([{ entry: e1, quotes: [{ quote: 'Attention is *all* you need', note: 'key idea', prefix: null, suffix: null, source_url: 'https://j.org/x' }] }]);
ok(md.startsWith('## [Attention Is All You Need](<https://j.org/x>)\nVaswani, Ashish, Noam Shazeer · NeurIPS · 2017') && md.includes('> Attention is \\*all\\* you need [↗](<https://j.org/x#:~:text=Attention%20is%20%2Aall%2A%20you%20need>)') && md.includes('key idea'), 'Markdown notes: heading, escaped quote, deep link, note');
eq(toBibtex([]), '', 'empty bibliography is empty'); eq(toApa([]), '', 'empty apa'); eq(toMarkdownNotes([]), '', 'empty notes');

console.log(fails ? `${fails} of ${n} failed` : `${n} checks ok`);
process.exit(fails ? 1 : 0);
