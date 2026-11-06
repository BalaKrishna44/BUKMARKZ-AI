import test from 'node:test'; import assert from 'node:assert/strict';
import { JOKE_POOL, poolJoke, validateJoke, parseModelJoke, weekKey, shareMailto, plainText, signFriday, jokePrompt, subjectFor, FRIDAY_REWARD } from './friday.ts';

test('every curated joke passes the same validator as AI jokes', () => {
  assert.ok(JOKE_POOL.length >= 10);
  for (const [i, j] of JOKE_POOL.entries()) assert.ok(validateJoke(j), `pool joke ${i} is invalid`);
});
test('pool pick is stable per week and always valid', () => {
  assert.equal(poolJoke('2026-W44'), poolJoke('2026-W44'));
  for (let w = 1; w <= 53; w++) assert.ok(validateJoke(poolJoke(`2026-W${String(w).padStart(2, '0')}`)));
});
test('validator accepts a good skit', () => {
  const t = [{ who: 'markz', text: 'I have 40 tabs open.' }, { who: 'buk', text: 'Impressive. Which one is the reason?' }, { who: 'markz', text: 'All of them!' }, { who: 'buk', text: 'Then none of them.' }];
  assert.equal(validateJoke(t)?.length, 4);
});
test('validator rejects: bad shape, order, length, links, markup, risky topics', () => {
  const ok = [{ who: 'markz', text: 'Hello there friend.' }, { who: 'buk', text: 'Hello Markz.' }, { who: 'markz', text: 'Tabs everywhere.' }, { who: 'buk', text: 'Naturally.' }];
  assert.ok(validateJoke(ok));
  const bad: [string, unknown][] = [
    ['not array', {}], ['too short', ok.slice(0, 3)], ['too long', [...ok, ...ok]], ['buk first', [...ok].reverse()],
    ['same speaker twice', [ok[0], ok[0], ok[1], ok[0]]], ['unknown speaker', ok.map((t, i) => (i === 1 ? { ...t, who: 'bob' } : t))],
    ['empty line', ok.map((t, i) => (i === 1 ? { ...t, text: ' ' } : t))], ['too long line', ok.map((t, i) => (i === 1 ? { ...t, text: 'x'.repeat(171) } : t))],
    ['url', ok.map((t, i) => (i === 1 ? { ...t, text: 'see https://evil.example now' } : t))], ['www', ok.map((t, i) => (i === 1 ? { ...t, text: 'go to www.x.org' } : t))],
    ['domain', ok.map((t, i) => (i === 1 ? { ...t, text: 'visit shop.com today' } : t))], ['email', ok.map((t, i) => (i === 1 ? { ...t, text: 'mail me a@b' } : t))],
    ['html', ok.map((t, i) => (i === 1 ? { ...t, text: '<b>bold</b> move' } : t))], ['markdown link', ok.map((t, i) => (i === 1 ? { ...t, text: '[click](x)' } : t))],
    ['profanity', ok.map((t, i) => (i === 1 ? { ...t, text: 'what the fuck' } : t))], ['politics', ok.map((t, i) => (i === 1 ? { ...t, text: 'the election is near' } : t))],
    ['alcohol', ok.map((t, i) => (i === 1 ? { ...t, text: 'I got drunk at standup' } : t))], ['non-string text', ok.map((t, i) => (i === 1 ? { ...t, text: 5 } : t))],
  ];
  for (const [name, v] of bad) assert.equal(validateJoke(v), null, name);
});
test('control and bidi characters are stripped', () => {
  const t = validateJoke([{ who: 'markz', text: 'Hi‮ there\r\nfriend' }, { who: 'buk', text: 'Hello' }, { who: 'markz', text: 'Tabs!' }, { who: 'buk', text: 'Yes.' }])!;
  assert.equal(t[0].text, 'Hi there friend');
});
test('model output: JSON inside prose or code fences parses; garbage does not', () => {
  const good = '{"turns":[{"who":"markz","text":"One more tab."},{"who":"buk","text":"There is always one more."},{"who":"markz","text":"Friday?"},{"who":"buk","text":"Friday."}]}';
  assert.equal(parseModelJoke('Here you go:\n```json\n' + good + '\n```')?.length, 4);
  for (const g of ['', 'no json', '{"turns": "x"}', '{broken', '{"turns":[]}']) assert.equal(parseModelJoke(g), null);
});
test('prompt forbids the risky topics and asks for JSON only', () => {
  const p = jokePrompt('2026-W44', ['x']);
  assert.match(p.system, /NEVER mention politics/); assert.match(p.system, /JSON only/);
});
test('week key uses the ISO week-year', () => {
  assert.equal(weekKey(new Date('2026-10-30T10:00:00Z')), '2026-W44');
  assert.equal(weekKey(new Date('2026-12-31T10:00:00Z')), '2026-W53');
  assert.equal(weekKey(new Date('2027-01-01T10:00:00Z')), '2026-W53');           // Friday 1 Jan 2027 still belongs to ISO week 53 of 2026
  assert.equal(weekKey(new Date('2024-12-30T10:00:00Z')), '2025-W01');
});
test('share link pre-fills the joke and the referral link, and is a mailto', () => {
  const href = shareMailto(poolJoke('2026-W44'), 'https://bukmarkz.com/signup?ref=abcd2345');
  assert.ok(href.startsWith('mailto:?subject='));
  const body = decodeURIComponent(href.split('&body=')[1]);
  assert.match(body, /Markz: /); assert.match(body, /Buk: /); assert.match(body, /signup\?ref=abcd2345/);
});
test('plain text: has the dialogue, CTA, share link, reward and unsubscribe', () => {
  const t = plainText({ turns: poolJoke('2026-W44'), ctaUrl: 'https://x/c', ctaLabel: 'Flush Open Tabs into Vault', signupUrl: 'https://x/s', unsubscribeUrl: 'https://x/u', weekSaves: 3 });
  for (const s of ['Markz:', 'Buk:', 'Flush Open Tabs into Vault: https://x/c', 'https://x/s', FRIDAY_REWARD, 'https://x/u', 'You saved 3 links']) assert.ok(t.includes(s), s);
  assert.ok(!plainText({ turns: poolJoke('2026-W44'), ctaUrl: 'a', ctaLabel: 'b', signupUrl: 'c', unsubscribeUrl: 'd', weekSaves: 0 }).includes('You saved'));
});
test('reward copy states the reward that 021_referrals.sql really grants', () => { assert.match(FRIDAY_REWARD, /30 days of Pro/); assert.match(FRIDAY_REWARD, /5 links/); });
test('subject is stable and not shouty', () => { assert.match(subjectFor(), /^Friday Vault After-Hours/); });
test('signature matches the Next.js unsubscribe route and differs from the digest one', async () => {
  process.env.ALERT_SIGNING_SECRET = 'secret-secret-secret';
  const { signFriday: nodeSign, verifyFridayToken } = await import('../../../growth-kit/lib/digest/friday.ts');
  const { signUser } = await import('./digest.ts');
  const edge = await signFriday('user-1', 'secret-secret-secret');
  assert.equal(edge, nodeSign('user-1'));
  assert.ok(verifyFridayToken('user-1', edge)); assert.ok(!verifyFridayToken('user-2', edge)); assert.ok(!verifyFridayToken('user-1', 'x'));
  assert.notEqual(edge, await signUser('user-1', 'secret-secret-secret'), 'a digest link must not unsubscribe the Friday email');
});
