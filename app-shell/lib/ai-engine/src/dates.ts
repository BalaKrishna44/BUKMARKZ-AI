/**
 * Time-zone-correct date maths with no dependencies (Intl only).
 * The model never does date arithmetic: it picks a token ("last_week") and THIS code turns it into instants.
 */

interface Parts { y: number; m: number; d: number; h: number; mi: number; s: number }

function partsInZone(date: Date, tz: string): Parts {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(date)) p[part.type] = part.value;
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute), s: Number(p.second) };
}

/** Milliseconds the zone is ahead of UTC at this instant (DST-aware). */
function offsetMs(date: Date, tz: string): number {
  const p = partsInZone(date, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(date.getTime() / 1000) * 1000;
}

/** Local wall-clock time in `tz` -> the real instant. Day/hour overflow is allowed (d = 32 rolls into next month). */
export function zonedTimeToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi, 0);
  const off1 = offsetMs(new Date(guess), tz);
  let result = guess - off1;
  const off2 = offsetMs(new Date(result), tz);
  if (off2 !== off1) result = guess - off2; // we crossed a DST change: use the offset valid at the result
  return new Date(result);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function safeZone(tz: string | null | undefined): string {
  return tz && isValidTimeZone(tz) ? tz : 'UTC';
}

export function startOfLocalDay(date: Date, tz: string): Date {
  const p = partsInZone(date, tz);
  return zonedTimeToUtc(p.y, p.m, p.d, 0, 0, tz);
}

export function addLocalDays(date: Date, days: number, tz: string): Date {
  const p = partsInZone(date, tz);
  return zonedTimeToUtc(p.y, p.m, p.d + days, p.h, p.mi, tz);
}

export function localHour(date: Date, tz: string): number {
  return partsInZone(date, tz).h;
}

/** 0 = Monday ... 6 = Sunday, in the user's zone. */
function localWeekday(date: Date, tz: string): number {
  const p = partsInZone(date, tz);
  return (new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() + 6) % 7;
}

export const DATE_TOKENS = ['today', 'yesterday', 'this_week', 'last_week', 'past_7_days', 'past_30_days', 'this_month', 'last_month'] as const;
export type DateToken = (typeof DATE_TOKENS)[number];

export interface DateRange { from: Date; to: Date } // `to` is exclusive

export function resolveDateRange(token: DateToken, now: Date, tz: string): DateRange {
  const today = startOfLocalDay(now, tz);
  const tomorrow = addLocalDays(today, 1, tz);
  switch (token) {
    case 'today':
      return { from: today, to: tomorrow };
    case 'yesterday':
      return { from: addLocalDays(today, -1, tz), to: today };
    case 'this_week': {
      const monday = addLocalDays(today, -localWeekday(now, tz), tz);
      return { from: monday, to: tomorrow };
    }
    case 'last_week': {
      const thisMonday = addLocalDays(today, -localWeekday(now, tz), tz);
      return { from: addLocalDays(thisMonday, -7, tz), to: thisMonday };
    }
    case 'past_7_days':
      return { from: addLocalDays(today, -6, tz), to: tomorrow };
    case 'past_30_days':
      return { from: addLocalDays(today, -29, tz), to: tomorrow };
    case 'this_month': {
      const p = partsInZone(now, tz);
      return { from: zonedTimeToUtc(p.y, p.m, 1, 0, 0, tz), to: tomorrow };
    }
    case 'last_month': {
      const p = partsInZone(now, tz);
      return { from: zonedTimeToUtc(p.y, p.m - 1, 1, 0, 0, tz), to: zonedTimeToUtc(p.y, p.m, 1, 0, 0, tz) };
    }
  }
}

export interface SendWindow { startHour: number; endHour: number } // e.g. 9 and 20 -> 09:00 to 19:59 local

/** The earliest moment at or after `now` that falls inside the user's daily window, in their own time zone. */
export function nextSendTime(now: Date, tz: string, window: SendWindow): Date {
  const p = partsInZone(now, tz);
  if (p.h >= window.startHour && p.h < window.endHour) return now;
  const dayOffset = p.h < window.startHour ? 0 : 1;
  return zonedTimeToUtc(p.y, p.m, p.d + dayOffset, window.startHour, 0, tz);
}
