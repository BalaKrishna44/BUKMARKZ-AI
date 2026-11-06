import { answerFromVault, search, stem, tokens } from '../lib/demo/sandbox';
import { LINKS, RESURFACE, QUIZ, SHORTS, SANDBOX_SUGGESTIONS, hostOf } from '../lib/demo/data';

let fails = 0, n = 0;
const ok = (c: boolean, m: string) => { n++; if (!c) { fails++; console.log('FAIL', m); } };

ok(stem('indexes') === 'index' && stem('policies') === 'policy' && stem('rows') === 'row' && stem('csv') === 'csv', 'stemming');
ok(tokens('How do I lock down rows per user?').join() === 'lock,down,row,per,user', 'tokens drop stop words');
const topId = (q: string) => search(q, LINKS)[0]?.link.id;
ok(topId('Which index should I use for vector search?') === 'l1', 'vector index question -> pgvector');
ok(topId('How do I lock down rows per user?') === 'l3', 'row-level question -> Postgres RLS docs');
ok(topId('What format are CSV exports?') === 'l7', 'CSV question -> RFC 4180');
ok(topId('How do I build a browser extension?') === 'l6', 'extension question -> Chrome docs');
for (const q of SANDBOX_SUGGESTIONS) ok(answerFromVault(q, LINKS).sources.length > 0, `suggestion answers: ${q}`);
const none = answerFromVault('quantum gardening recipes', LINKS);
ok(none.sources.length === 0 && /couldn't find/.test(none.answer), 'unknown topic -> honest "not found"');
ok(answerFromVault('', LINKS).sources.length === 0 && answerFromVault('the of and', LINKS).sources.length === 0, 'empty / all-stop-word query');
ok(search('vectors', LINKS).length <= 3, 'at most 3 sources');
ok(answerFromVault('pgvector', LINKS).sources[0].host === 'github.com', 'source host extracted');
// mock data integrity
const ids = new Set(LINKS.map((l) => l.id));
ok(ids.size === LINKS.length, 'unique link ids');
ok(RESURFACE.length === 5 && RESURFACE.every((r) => ids.has(r.id)), 'resurface: 5 items, all exist');
ok(ids.has(QUIZ.fromId) && QUIZ.answerIndex >= 0 && QUIZ.answerIndex < QUIZ.options.length, 'quiz answer index valid');
ok(LINKS.every((l) => /^https:\/\//.test(l.url) && hostOf(l.url) !== ''), 'all mock links are https with a host');
ok(SHORTS.every((s) => s.embedId === null || /^[\w-]{11}$/.test(s.embedId)), 'embed ids are 11 chars or null');
console.log(fails ? `${fails} of ${n} failed` : `${n} checks ok`);
process.exit(fails ? 1 : 0);
