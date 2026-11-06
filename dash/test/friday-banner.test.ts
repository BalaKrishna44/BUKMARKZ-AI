import test from 'node:test'; import assert from 'node:assert/strict';
import { shouldShowBanner, dayKey } from '../lib/friday/banner.ts';
const fri = (h: number) => new Date(2026, 9, 30, h, 0);   // Fri 30 Oct 2026, local time
test('Friday from noon', () => { assert.ok(shouldShowBanner(fri(12), '', null)); assert.ok(shouldShowBanner(fri(16), '', null)); assert.ok(!shouldShowBanner(fri(11), '', null)); });
test('other days stay quiet', () => { assert.ok(!shouldShowBanner(new Date(2026, 9, 29, 16), '', null)); assert.ok(!shouldShowBanner(new Date(2026, 9, 31, 16), '', null)); });
test('the email button always shows it, any day', () => { assert.ok(shouldShowBanner(new Date(2026, 9, 28, 9), '?intent=flush', null)); assert.ok(!shouldShowBanner(new Date(2026, 9, 28, 9), '?intent=other', null)); });
test('dismissed today means hidden today, back next Friday', () => {
  assert.ok(!shouldShowBanner(fri(16), '?intent=flush', dayKey(fri(16))));
  assert.ok(shouldShowBanner(new Date(2026, 10, 6, 16), '', dayKey(fri(16))));
});
