import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addLocalDays, nextSendTime, resolveDateRange, safeZone, startOfLocalDay, zonedTimeToUtc } from '../src/dates.ts';

const iso = (d: Date) => d.toISOString();
const NOW = new Date('2026-10-20T10:00:00Z'); // Tuesday 15:30 in India
const IST = 'Asia/Kolkata';

describe('time zone maths', () => {
  it('turns local wall-clock time into the right instant', () => {
    assert.equal(iso(zonedTimeToUtc(2026, 10, 20, 0, 0, IST)), '2026-10-19T18:30:00.000Z');
  });

  it('finds the start of the LOCAL day even when UTC is on the previous or next date', () => {
    assert.equal(iso(startOfLocalDay(new Date('2026-10-20T20:00:00Z'), IST)), '2026-10-20T18:30:00.000Z'); // already Wed 01:30 in India
    assert.equal(iso(startOfLocalDay(new Date('2026-10-20T02:00:00Z'), 'America/Los_Angeles')), '2026-10-19T07:00:00.000Z');
  });

  it('handles the 25-hour day when daylight saving ends', () => {
    const start = startOfLocalDay(new Date('2026-11-01T12:00:00Z'), 'America/New_York');
    assert.equal(iso(start), '2026-11-01T04:00:00.000Z');
    assert.equal(iso(addLocalDays(start, 1, 'America/New_York')), '2026-11-02T05:00:00.000Z');
  });

  it('falls back to UTC for unknown zones', () => {
    assert.equal(safeZone('Mars/Olympus'), 'UTC');
    assert.equal(safeZone(null), 'UTC');
    assert.equal(safeZone('Asia/Kolkata'), 'Asia/Kolkata');
  });
});

describe('resolveDateRange (now = Tue 20 Oct 2026, 15:30 in India)', () => {
  const r = (t: Parameters<typeof resolveDateRange>[0]) => {
    const { from, to } = resolveDateRange(t, NOW, IST);
    return [iso(from), iso(to)];
  };
  it('today / yesterday', () => {
    assert.deepEqual(r('today'), ['2026-10-19T18:30:00.000Z', '2026-10-20T18:30:00.000Z']);
    assert.deepEqual(r('yesterday'), ['2026-10-18T18:30:00.000Z', '2026-10-19T18:30:00.000Z']);
  });
  it('this week starts on Monday', () => {
    assert.deepEqual(r('this_week'), ['2026-10-18T18:30:00.000Z', '2026-10-20T18:30:00.000Z']);
  });
  it('last week is the previous Monday-to-Sunday', () => {
    assert.deepEqual(r('last_week'), ['2026-10-11T18:30:00.000Z', '2026-10-18T18:30:00.000Z']);
  });
  it('rolling windows include today', () => {
    assert.deepEqual(r('past_7_days'), ['2026-10-13T18:30:00.000Z', '2026-10-20T18:30:00.000Z']);
    assert.deepEqual(r('past_30_days'), ['2026-09-20T18:30:00.000Z', '2026-10-20T18:30:00.000Z']);
  });
  it('this month / last month', () => {
    assert.deepEqual(r('this_month'), ['2026-09-30T18:30:00.000Z', '2026-10-20T18:30:00.000Z']);
    assert.deepEqual(r('last_month'), ['2026-08-31T18:30:00.000Z', '2026-09-30T18:30:00.000Z']);
  });
  it('last month in January reaches back into the previous year', () => {
    const { from, to } = resolveDateRange('last_month', new Date('2027-01-15T12:00:00Z'), 'UTC');
    assert.equal(iso(from), '2026-12-01T00:00:00.000Z');
    assert.equal(iso(to), '2027-01-01T00:00:00.000Z');
  });
  it('a week that starts on Sunday in UTC is still Monday-based', () => {
    const { from } = resolveDateRange('this_week', new Date('2026-10-18T12:00:00Z'), 'UTC'); // a Sunday
    assert.equal(iso(from), '2026-10-12T00:00:00.000Z');
  });
});

describe('nextSendTime (window 09:00-20:00 local)', () => {
  const w = { startHour: 9, endHour: 20 };
  it('sends right away inside the window', () => {
    assert.equal(iso(nextSendTime(NOW, IST, w)), iso(NOW));
  });
  it('waits until tomorrow morning after the window closes', () => {
    assert.equal(iso(nextSendTime(new Date('2026-10-20T16:30:00Z'), IST, w)), '2026-10-21T03:30:00.000Z'); // 22:00 in India
  });
  it('waits until this morning before the window opens', () => {
    assert.equal(iso(nextSendTime(new Date('2026-10-20T00:00:00Z'), IST, w)), '2026-10-20T03:30:00.000Z'); // 05:30 in India
  });
  it('the end hour itself is outside the window', () => {
    assert.equal(iso(nextSendTime(new Date('2026-10-20T14:30:00Z'), IST, w)), '2026-10-21T03:30:00.000Z'); // 20:00 in India
  });
});
