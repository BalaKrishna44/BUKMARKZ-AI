import { acceptQuiz, norm, pickQuizItems, quizSource, QUIZ_MAX_SOURCE, QUIZ_MIN_SOURCE } from '../lib/resurface/quiz';
import { ago, whyText } from '../lib/resurface/why';
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('ok  ', m); } else { fail++; console.error('FAIL', m); } };

const para = 'PostgreSQL uses MVCC, so readers never block writers. '.repeat(12);
ok(quizSource({ id: 'a', full_markdown_content: para })?.length === para.trim().length, 'uses archived page text');
ok(quizSource({ id: 'a', full_markdown_content: 'short', ocr_extracted_text: para }) !== null && quizSource({ id: 'a', summary: para.slice(0, 300), note: para.slice(0, 150) }) !== null, 'falls back to OCR, then summary + note');
ok(quizSource({ id: 'a', title: 'T'.repeat(500) }) === null && quizSource({ id: 'a', full_markdown_content: 'x'.repeat(QUIZ_MIN_SOURCE - 1) }) === null, 'a title or thin text is not enough');
const big = quizSource({ id: 'a', full_markdown_content: ('word '.repeat(60) + '\n\n').repeat(100) })!;
ok(big.length <= QUIZ_MAX_SOURCE && big.length > QUIZ_MAX_SOURCE * 0.7, 'long text cut at a paragraph boundary');

const items = [
  { id: '1', ai_status: 'skipped_private', full_markdown_content: para },
  { id: '2', full_markdown_content: 'tiny' },
  { id: '3', full_markdown_content: para },
  { id: '4', full_markdown_content: para },
  { id: '5', full_markdown_content: para },
];
ok(pickQuizItems(items, 2).map((x) => x.item.id).join() === '3,4', 'private bookmarks never reach the model; items without text are skipped; rank order kept');
ok(pickQuizItems([{ id: 'p', ai_status: 'skipped_private', full_markdown_content: para }]).length === 0, 'only private items -> no quiz source at all');

const SRC = 'PostgreSQL uses MVCC, so readers never block writers. Autovacuum removes dead tuples left behind by updates.';
const good = { question: 'Why can readers and writers run at the same time in PostgreSQL?', answer: 'Because it uses MVCC.', evidence: 'PostgreSQL uses MVCC, so readers never block writers.' };
ok(acceptQuiz(good, SRC)?.answer === 'Because it uses MVCC.', 'accepts a grounded question');
ok(acceptQuiz({ ...good, evidence: 'PostgreSQL   uses  MVCC, so readers never block writers.' }, SRC) !== null, 'whitespace differences in the quote are tolerated');
ok(acceptQuiz({ ...good, evidence: 'PostgreSQL shards data across nodes with Citus.' }, SRC) === null, 'invented evidence -> rejected (hallucination gate)');
ok(acceptQuiz({ ...good, question: 'What does the author say about MVCC and readers?' }, SRC) === null, '"the author / this article" questions rejected');
ok(acceptQuiz({ ...good, question: 'What does MVCC allow in PostgreSQL concurrency?', answer: 'MVCC' }, SRC) === null, 'answer given away in the question -> rejected');
ok(acceptQuiz({ ...good, answer: 'Yes' }, SRC) === null && acceptQuiz({ ...good, question: 'Short?' }, SRC) === null && acceptQuiz({ ...good, evidence: 'too short' }, SRC) === null, 'yes/no, too-short question, too-short evidence rejected');
ok(acceptQuiz(null, SRC) === null && acceptQuiz('x', SRC) === null && acceptQuiz({ question: 1 }, SRC) === null && acceptQuiz({}, SRC) === null, 'garbage model output -> null, no throw');
ok(norm('**Bold** “quoted” `code`  text') === 'bold "quoted" code text', 'normalisation');

// reasons shown under each link
const now = new Date('2026-10-29T00:00:00Z');
ok(ago(3) === '3 days' && ago(1) === '1 day' && ago(21) === '3 weeks' && ago(100) === '3 months' && ago(800) === '2 years', 'ago() wording');
ok(whyText({ id: 'x', unread: true, days_since: 120, sim: 0.8 }, '2026-06-01T00:00:00Z', now) === 'Saved 5 months ago, never opened · related to this week’s saves', 'unread + related');
ok(whyText({ id: 'x', unread: false, days_since: 45, sim: 0.2 }, '2026-01-01T00:00:00Z', now) === 'Not opened in 6 weeks', 'opened long ago, unrelated');
ok(whyText({ id: 'x', unread: true, days_since: 9, sim: null }, undefined, now) === 'Never opened', 'missing date and similarity are handled');
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
