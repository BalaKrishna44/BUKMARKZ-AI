import test from 'node:test'; import assert from 'node:assert/strict';
import { computeChecklist, MIN_ITEMS_FOR_ASK } from '../lib/onboarding/checklist';
const base = { items: 0, dismissed: false, extension: false, asked: false, remixed: false };
test('fresh user: first step is adding links; ask is not suggested yet', () => {
  const c = computeChecklist(base);
  assert.equal(c.doneCount, 0); assert.equal(c.next?.id, 'import_or_save'); assert.equal(c.visible, true);
  assert.match(c.steps[1].hint, /Add 5 more links first/);
});
test('after enough links the next step is Ask', () => {
  const c = computeChecklist({ ...base, items: MIN_ITEMS_FOR_ASK });
  assert.equal(c.steps[0].done, true); assert.equal(c.next?.id, 'ask'); assert.match(c.steps[1].hint, /Ask/);
});
test('4 links says "1 more link" (singular)', () => {
  assert.match(computeChecklist({ ...base, items: 4 }).steps[1].hint, /Add 1 more link first/);
});
test('everything done hides the card; dismissed hides it too', () => {
  const all = computeChecklist({ items: 9, dismissed: false, extension: true, asked: true, remixed: true });
  assert.equal(all.complete, true); assert.equal(all.visible, false); assert.equal(all.next, null);
  assert.equal(computeChecklist({ ...base, dismissed: true }).visible, false);
});
test('bad numbers are treated as zero', () => {
  assert.equal(computeChecklist({ ...base, items: NaN }).steps[0].done, false);
  assert.equal(computeChecklist({ ...base, items: -3 }).steps[0].done, false);
});
test('ask done but few links still moves on to the next undone step', () => {
  const c = computeChecklist({ ...base, items: 2, asked: true });
  assert.equal(c.next?.id, 'import_or_save');
});
