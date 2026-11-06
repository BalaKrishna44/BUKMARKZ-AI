import test from 'node:test'; import assert from 'node:assert/strict';
process.env.ALERT_SIGNING_SECRET = 'x'.repeat(32);
import { buildDigest, monthsAgo, signUser, verifyUserToken, unsubscribeUrl, type DigestItem } from '../lib/digest/build';
import { runDigest, type DigestDeps } from '../lib/digest/run';

const NOW = new Date('2026-10-29T00:00:00Z');
const it = (n: number, o: Partial<DigestItem> = {}): DigestItem => ({ id: `id${n}`, title: `Title ${n}`, url: `https://www.site${n}.com/p`, created_at: '2026-06-01T00:00:00Z', ...o });
const U1 = '11111111-1111-1111-1111-111111111111', U2 = '22222222-2222-2222-2222-222222222222', U3 = '33333333-3333-3333-3333-333333333333';

test('needs at least 3 links, caps at 5', () => {
  assert.equal(buildDigest([it(1), it(2)], 'https://b.com', 'u', NOW), null);
  const m = buildDigest(Array.from({ length: 8 }, (_, i) => it(i)), 'https://b.com', 'https://b.com/u', NOW)!;
  assert.equal(m.ids.length, 5); assert.match(m.subject, /^5 links/);
});
test('html is escaped; unsubscribe link in both parts', () => {
  const m = buildDigest([it(1, { title: '<img src=x onerror=alert(1)>' }), it(2), it(3)], 'https://b.com', 'https://b.com/u?a=1&t=2', NOW)!;
  assert.ok(!m.html.includes('<img')); assert.ok(m.html.includes('&lt;img')); assert.ok(m.html.includes('a=1&amp;t=2')); assert.ok(m.text.includes('https://b.com/u?a=1&t=2'));
});
test('age wording', () => { assert.equal(monthsAgo('2026-10-01T00:00:00Z', NOW), '4 weeks ago'); assert.equal(monthsAgo('2026-06-01T00:00:00Z', NOW), '5 months ago'); assert.equal(monthsAgo('2024-10-01T00:00:00Z', NOW), '2 years ago'); });
test('signed tokens: valid, tampered, wrong user, malformed', () => {
  const t = signUser(U1);
  assert.equal(verifyUserToken(U1, t), true); assert.equal(verifyUserToken(U2, t), false);
  assert.equal(verifyUserToken(U1, t.replace(/.$/, t.endsWith('0') ? '1' : '0')), false); assert.equal(verifyUserToken(U1, 'nope'), false);
  assert.match(unsubscribeUrl('https://b.com', U1), /\/api\/digest\/unsubscribe\?u=.*&t=[0-9a-f]{64}$/);
});

function deps(over: Partial<DigestDeps> = {}) {
  const log = { sent: [] as string[], recorded: [] as string[], released: [] as string[] };
  const d: DigestDeps = {
    site: 'https://b.com', now: () => NOW,
    claim: async () => [{ user_id: U1, last_item_ids: [] }, { user_id: U2, last_item_ids: [] }, { user_id: U3, last_item_ids: [] }],
    pick: async (uid) => (uid === U2 ? [it(1)] : [it(1), it(2), it(3)]),
    emailOf: async (uid) => (uid === U3 ? null : `${uid.slice(0, 2)}@x.com`),
    send: async (m) => { log.sent.push(m.to); return true; },
    record: async (uid) => { log.recorded.push(uid); }, release: async (uid) => { log.released.push(uid); }, ...over };
  return { d, log };
}
test('run: sends, skips thin libraries, skips users without email', async () => {
  const { d, log } = deps(); const r = await runDigest(d);
  assert.deepEqual(r, { claimed: 3, sent: 1, skippedFewLinks: 1, noEmail: 1, failed: 0 }); assert.deepEqual(log.recorded, [U1]);
});
test('run: a failed send is released for retry; an exception is contained', async () => {
  const a = deps({ send: async () => false }); const r1 = await runDigest(a.d);
  assert.equal(r1.failed, 1); assert.deepEqual(a.log.released, [U1]);
  const b = deps({ pick: async () => { throw new Error('db down'); } }); const r2 = await runDigest(b.d);
  assert.equal(r2.failed, 2); assert.deepEqual(b.log.released, [U1, U2]);
});
test('run: out of time hands the rest back', async () => {
  const { d, log } = deps(); const r = await runDigest(d, 200, -1);
  assert.equal(r.sent, 0); assert.equal(log.released.length, 3);
});
