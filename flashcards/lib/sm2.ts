// Spaced-repetition scheduling. Pure and dependency-free: used by the UI (interval previews) and tested against sql/010 review_card().
export type Rating = 0 | 1 | 2 | 3;                 // again, hard, good, easy
export type CardState = 'new' | 'learning' | 'review' | 'suspended';
export interface Sched { state: CardState; ease: number; interval_days: number; reps: number; lapses: number }
export interface Next extends Sched { due_in_ms: number }

export const RATINGS = [
  { value: 0 as Rating, label: 'Again', key: '1' },
  { value: 1 as Rating, label: 'Hard', key: '2' },
  { value: 2 as Rating, label: 'Good', key: '3' },
  { value: 3 as Rating, label: 'Easy', key: '4' },
];
export const MIN_EASE = 130, MAX_EASE = 300, LEECH_LAPSES = 8, RELEARN_MS = 10 * 60_000, DAY_MS = 864e5;

const rdiv = (a: number, b: number) => Math.floor((2 * a + b) / (2 * b));          // round-half-up on integers: exact, matches numeric round()
/** Integer arithmetic on ease*100 so results match PostgreSQL's numeric rounding exactly. */
export function schedule(c: Sched, rating: Rating): Next {
  let e = Math.round(c.ease * 100), iv = c.interval_days, r = c.reps, l = c.lapses;
  if (rating === 0) {
    l += 1; r = 0; iv = 0; e = Math.max(MIN_EASE, e - 20);
    return { state: l >= LEECH_LAPSES ? 'suspended' : 'learning', ease: e / 100, interval_days: 0, reps: 0, lapses: l, due_in_ms: RELEARN_MS };
  }
  if (rating === 1) { iv = Math.max(1, rdiv(Math.max(iv, 1) * 12, 10)); e = Math.max(MIN_EASE, e - 15); }
  else if (rating === 2) iv = r === 0 ? 1 : r === 1 ? 3 : Math.max(iv + 1, rdiv(iv * e, 100));
  else { iv = r === 0 ? 4 : Math.max(iv + 1, rdiv(iv * e * 13, 1000)); e = Math.min(MAX_EASE, e + 15); }
  return { state: 'review', ease: e / 100, interval_days: iv, reps: r + 1, lapses: l, due_in_ms: iv * DAY_MS };
}

export function formatInterval(ms: number): string {
  if (ms < 60 * 60_000) return `${Math.max(1, Math.round(ms / 60_000))}m`;
  const d = ms / DAY_MS;
  if (d < 1) return `${Math.round(ms / 3_600_000)}h`;
  if (d < 30) return `${Math.round(d)}d`;
  if (d < 365) return `${Math.round(d / 30)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}
/** Labels for the four answer buttons, e.g. ['10m','1d','3d','4d']. */
export const previewLabels = (c: Sched): string[] => ([0, 1, 2, 3] as Rating[]).map((r) => formatInterval(schedule(c, r).due_in_ms));

// ── local-day helpers (daily new-card limit and streak must follow the user's calendar, not UTC) ──
export const validTimeZone = (tz: unknown): tz is string => { if (typeof tz !== 'string' || tz.length > 64) return false; try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };

function parts(tz: string, d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}
const offsetMs = (tz: string, d: Date) => { const p = parts(tz, d); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(d.getTime() / 1000) * 1000; };
/** The UTC instant at which the user's current local day began. */
export function startOfLocalDay(tz: string, now: Date = new Date()): Date {
  const p = parts(tz, now);
  const utcMidnight = Date.UTC(p.y, p.m - 1, p.d);
  let guess = utcMidnight - offsetMs(tz, new Date(utcMidnight));
  guess = utcMidnight - offsetMs(tz, new Date(guess));                      // second pass settles DST transitions
  return new Date(guess);
}
export const localDay = (tz: string, d: Date) => { const p = parts(tz, d); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; };

/** days: distinct 'YYYY-MM-DD' review days. The streak survives until the end of the day after your last review. */
export function streak(days: string[], today: string): number {
  const set = new Set(days);
  const prev = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10); };
  let cur = set.has(today) ? today : prev(today);
  let n = 0;
  while (set.has(cur)) { n++; cur = prev(cur); }
  return n;
}
