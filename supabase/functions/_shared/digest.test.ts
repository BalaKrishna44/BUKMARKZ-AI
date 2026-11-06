import test from 'node:test'; import assert from 'node:assert/strict';
import { recapOf, ageLabel, toRows, bearerOk, signUser, isoWeek, plainText } from './digest.ts';
test('recap is the first sentence, with a fallback', () => {
  assert.equal(recapOf('Explains B-trees. Also covers WAL.', 't'), 'Explains B-trees.');
  assert.match(recapOf(null, 'My Title'), /My Title/);
  assert.ok(recapOf('x'.repeat(400), 't').length <= 160);
});
test('age labels', () => { const n = new Date('2026-10-30'); assert.equal(ageLabel('2026-08-30', n), '2 months ago'); assert.equal(ageLabel('2026-10-10', n), '3 weeks ago'); });
test('rows cap at 5, link to item', () => { const it = Array.from({ length: 8 }, (_, i) => ({ id: 'id' + i, title: 'T' + i, url: 'https://www.a.com/' + i, created_at: '2026-01-01', summary: null })); const r = toRows(it, 'https://s.com'); assert.equal(r.length, 5); assert.equal(r[0].host, 'a.com'); assert.equal(r[0].href, 'https://s.com/dashboard?item=id0'); assert.match(plainText(r, 'q', 'u'), /Recall Quiz: q/); });
test('bearer check', () => { const s = 'a'.repeat(20); assert.ok(bearerOk('Bearer ' + s, s)); assert.ok(!bearerOk('Bearer ' + s + 'x', s)); assert.ok(!bearerOk(null, s)); assert.ok(!bearerOk('Bearer short', 'short')); });
test('signature matches the Next.js unsubscribe route', async () => {
  process.env.ALERT_SIGNING_SECRET = 'secret-secret-secret';
  const { signUser: nodeSign } = await import('../../../growth-kit/lib/digest/build.ts');
  assert.equal(await signUser('user-1', 'secret-secret-secret'), nodeSign('user-1'));
});
test('iso week', () => { assert.equal(isoWeek(new Date('2026-01-05')), 2); });
