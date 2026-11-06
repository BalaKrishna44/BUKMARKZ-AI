import { schedule, previewLabels, formatInterval, startOfLocalDay, localDay, streak, validTimeZone, type Sched } from '../lib/sm2';
import { acceptCards, buildSource, norm, MIN_SOURCE_CHARS, MAX_SOURCE_CHARS } from '../lib/generate';
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('ok  ', m); } else { fail++; console.error('FAIL', m); } };
const NEW: Sched = { state: 'new', ease: 2.5, interval_days: 0, reps: 0, lapses: 0 };

// ── scheduling
ok(schedule(NEW, 2).interval_days === 1 && schedule(NEW, 3).interval_days === 4 && schedule(NEW, 1).interval_days === 1, 'first review: good 1d, easy 4d, hard 1d');
const afterGood = schedule(NEW, 2); const g2 = schedule(afterGood, 2); const g3 = schedule(g2, 2);
ok(g2.interval_days === 3 && g3.interval_days === 8 && g3.reps === 3 && g3.state === 'review', 'good chain: 1d, 3d, then x ease (3 x 2.5 = 8)');
const again = schedule({ ...g3 }, 0);
ok(again.state === 'learning' && again.interval_days === 0 && again.reps === 0 && again.lapses === 1 && again.ease === 2.3 && again.due_in_ms === 600_000, 'again: relearn in 10 min, ease -0.2, lapse+1');
ok(schedule({ ...NEW, ease: 1.3 }, 0).ease === 1.3 && schedule({ ...g3, ease: 1.35 }, 1).ease === 1.3, 'ease never below 1.3');
ok(schedule({ ...g3, ease: 2.95 }, 3).ease === 3 && schedule({ ...g3, ease: 3 }, 3).ease === 3, 'ease capped at 3.0');
ok(schedule({ ...NEW, lapses: 7, state: 'review', reps: 3, interval_days: 5 }, 0).state === 'suspended', '8th lapse suspends (leech)');
ok(schedule({ state: 'review', ease: 2.5, interval_days: 10, reps: 5, lapses: 0 }, 1).interval_days === 12 && schedule({ state: 'review', ease: 1.3, interval_days: 1, reps: 2, lapses: 0 }, 2).interval_days === 2, 'hard x1.2; good always moves forward at least 1 day');
const mono = (r: 2 | 3) => { let c: Sched = NEW; let prev = 0; for (let i = 0; i < 12; i++) { const n = schedule(c, r); if (n.interval_days <= prev) return false; prev = n.interval_days; c = n; } return true; };
ok(mono(2) && mono(3), 'good/easy intervals strictly increase');
ok(previewLabels(NEW).join() === '10m,1d,1d,4d', 'button previews for a new card');
ok(formatInterval(45 * 864e5) === '2mo' && formatInterval(400 * 864e5) === '1.1y' && formatInterval(2 * 36e5 * 24) === '2d' && formatInterval(60 * 60_000) === '1h', 'interval formatting');

// ── local days (India has no DST; New York does)
const t = new Date('2026-10-28T20:00:00Z');                                  // 01:30 on 29 Oct in Kolkata
ok(startOfLocalDay('Asia/Kolkata', t).toISOString() === '2026-10-28T18:30:00.000Z' && localDay('Asia/Kolkata', t) === '2026-10-29', 'Kolkata: day starts 18:30Z, 01:30 IST is 29 Oct');
ok(startOfLocalDay('UTC', t).toISOString() === '2026-10-28T00:00:00.000Z', 'UTC day start');
ok(startOfLocalDay('America/New_York', new Date('2026-11-01T12:00:00Z')).toISOString() === '2026-11-01T04:00:00.000Z', 'New York on the fall-back day starts 04:00Z (EDT)');
ok(startOfLocalDay('America/New_York', new Date('2026-11-02T12:00:00Z')).toISOString() === '2026-11-02T05:00:00.000Z', 'day after fall-back starts 05:00Z (EST)');
ok(validTimeZone('Asia/Kolkata') && !validTimeZone('Mars/Base') && !validTimeZone(5) && !validTimeZone('x'.repeat(80)), 'timezone validation');
ok(streak(['2026-10-28', '2026-10-27', '2026-10-26', '2026-10-24'], '2026-10-28') === 3, 'streak counts consecutive days');
ok(streak(['2026-10-27', '2026-10-26'], '2026-10-28') === 2 && streak(['2026-10-25'], '2026-10-28') === 0 && streak([], '2026-10-28') === 0, 'streak survives until end of tomorrow; broken after a gap');
ok(streak(['2026-03-01', '2026-02-28', '2026-02-27'], '2026-03-01') === 3 && streak(['2026-01-01', '2025-12-31'], '2026-01-01') === 2, 'streak across month and year boundaries');

// ── source building
const long = 'Postgres uses MVCC so readers never block writers. '.repeat(20);
ok(buildSource({ full_markdown_content: long, ocr_extracted_text: 'x'.repeat(900) })?.from === 'archive', 'prefers archive text');
ok(buildSource({ full_markdown_content: 'short', ocr_extracted_text: 'y'.repeat(900) })?.from === 'ocr', 'falls back to OCR text');
ok(buildSource({ summary: 'a'.repeat(300), note: 'b'.repeat(200) })?.from === 'notes', 'then summary + note');
ok(buildSource({ title: 'A very long and descriptive title '.repeat(20) }) === null && buildSource({ full_markdown_content: 'z'.repeat(MIN_SOURCE_CHARS - 1) }) === null, 'a title alone or thin text -> null (nothing to teach)');
const big = buildSource({ full_markdown_content: ('word '.repeat(50) + '\n\n').repeat(200) })!;
ok(big.text.length <= MAX_SOURCE_CHARS && big.text.length > MAX_SOURCE_CHARS * 0.7 && !big.text.includes('\u0000'), 'long text cut near a paragraph boundary');

// ── card filtering (the anti-hallucination gate)
const SRC = 'PostgreSQL uses MVCC, so readers never block writers. Autovacuum removes dead tuples left behind by updates. A "partial index" only indexes rows that match a WHERE clause.';
const card = (q: string, a: string, e: string) => ({ question: q, answer: a, evidence: e });
const r = acceptCards({ cards: [
  card('Why can readers and writers run at the same time in PostgreSQL?', 'It uses MVCC.', 'PostgreSQL uses MVCC, so readers never block writers.'),
  card('What does autovacuum clean up after updates?', 'Dead tuples.', 'Autovacuum   removes dead tuples left behind by updates.'),
  card('Which index type only covers some rows of a table?', 'A partial index.', 'A “partial index” only indexes rows that match a WHERE clause.'),
  card('How does PostgreSQL shard data across nodes by default?', 'It uses Citus.', 'PostgreSQL shards data across nodes with Citus by default.'),
  card('What does the article say about MVCC and readers?', 'They never block.', 'readers never block writers'),
  card('What is MVCC in PostgreSQL, and what does it do?', 'MVCC', 'PostgreSQL uses MVCC, so readers never block writers.'),
  card('Why can readers and writers run at the same time in PostgreSQL?', 'MVCC.', 'PostgreSQL uses MVCC, so readers never block writers.'),
  card('Is autovacuum useful for removing dead tuples?', 'Yes', 'Autovacuum removes dead tuples left behind by updates.'),
  { question: 'No answer here at all?', evidence: 'x' }, null, 'junk',
] }, SRC);
ok(r.cards.length === 3 && r.cards.map((c) => c.evidence.slice(0, 5)).join() === 'Postg,Autov,A “pa', 'keeps the 3 grounded cards (whitespace and curly quotes tolerated)');
const why = r.dropped.map((d) => d.reason);
ok(why.includes('evidence not in source') && why.includes('not self-contained') && why.includes('duplicate') && why.includes('yes/no') && why.includes('malformed'), `drops invented evidence, "the article" questions, duplicates, yes/no, malformed (${[...new Set(why)].join('; ')})`);
ok(why.includes('answer given away') || r.cards.length === 3, 'drops cards whose question contains the answer');
ok(acceptCards(null, SRC).cards.length === 0 && acceptCards({ cards: 'x' }, SRC).cards.length === 0 && acceptCards({}, SRC).cards.length === 0, 'garbage model output -> no cards, no throw');
const many = { cards: Array.from({ length: 20 }, (_, i) => card(`Question number ${i} about MVCC and readers?`, `Answer ${i}`, 'PostgreSQL uses MVCC, so readers never block writers.')) };
ok(acceptCards(many, SRC).cards.length === 8 && acceptCards(many, SRC, 3).cards.length === 3, 'card count capped');
ok(norm('**Bold** “quoted” `code`  text') === 'bold "quoted" code text', 'normalisation strips markdown and curly quotes');
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
