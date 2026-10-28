/**
 * Feature 4: the 48-hour review nudge.
 *
 *   every ~15 min:  find bookmarks saved 48h+ ago and never opened
 *                   -> per user: respect their time zone, a daily cap and "push off" -> build the notification
 *                   -> INSERT into reminder_queue  (one row per bookmark, ever: UNIQUE(bookmark_id, kind))
 *   dispatcher.ts:  sends what is due, re-checking first that the item is still unread
 *
 * Because of that unique key the tick is idempotent: run it twice, run two workers, restart it mid-way, and nobody gets
 * a duplicate nudge. Private bookmarks are never selected (their titles must not appear on a lock screen).
 */
import { addLocalDays, nextSendTime, safeZone, startOfLocalDay, type SendWindow } from './dates.ts';
import { ellipsize } from './security.ts';

export interface ReviewCandidate {
  bookmarkId: string;
  userId: string;
  title: string | null;
  url: string | null;
  platform: string | null;
  createdAt: Date;
  timezone: string | null;
  totalSteps: number;
  openSteps: number;
}

export interface NotificationPayload {
  title: string;
  body: string;
  data: { type: 'review_48h'; bookmarkId: string; deepLink: string };
  /** a newer push with the same key replaces the old one on the device */
  collapseKey: string;
}

export interface SchedulerConfig {
  afterHours: number;
  /** Older unread items are left alone: nudging about something saved two months ago feels like nagging. */
  maxAgeDays: number;
  maxPerUserPerDay: number;
  window: SendWindow;
  batchSize: number;
  deepLinkBase: string;
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  afterHours: 48,
  maxAgeDays: 30,
  maxPerUserPerDay: 2,
  window: { startHour: 9, endHour: 20 },
  batchSize: 500,
  deepLinkBase: 'bukmarkz://bookmark/',
};

export function ageText(createdAt: Date, now: Date): string {
  const hours = Math.floor((now.getTime() - createdAt.getTime()) / 3_600_000);
  if (hours < 24) return `${Math.max(hours, 1)} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

function displayTitle(c: ReviewCandidate): string {
  const t = c.title?.trim();
  if (t) return ellipsize(t, 48);
  try {
    if (c.url) return new URL(c.url).hostname.replace(/^www\./, '');
  } catch {
    /* fall through */
  }
  return 'a link';
}

/** Context-aware copy: it mentions the checklist only if there is one, and how many steps are left. */
export function buildReviewPayload(c: ReviewCandidate, now: Date, deepLinkBase = DEFAULT_SCHEDULER_CONFIG.deepLinkBase): NotificationPayload {
  const saved = `💡 You saved “${displayTitle(c)}” ${ageText(c.createdAt, now)}.`;
  let ask: string;
  if (c.totalSteps > 0 && c.openSteps === c.totalSteps) ask = `Ready to review your ${c.totalSteps}-step action checklist?`;
  else if (c.openSteps > 0) ask = `${c.openSteps} step${c.openSteps === 1 ? '' : 's'} left on your checklist. Pick it back up?`;
  else ask = 'Ready to give it a look?';
  return {
    title: 'Bukmarkz',
    body: `${saved} ${ask}`,
    data: { type: 'review_48h', bookmarkId: c.bookmarkId, deepLink: `${deepLinkBase}${c.bookmarkId}${c.totalSteps > 0 ? '?checklist=1' : ''}` },
    collapseKey: `review-${c.bookmarkId}`,
  };
}

export interface SchedulerStore {
  /** Unread, unarchived, non-private, not yet queued; grouped by user, best candidates first within each user. */
  findReviewCandidates(p: { afterHours: number; maxAgeDays: number; limit: number }): Promise<ReviewCandidate[]>;
  /** Reminders already planned for this user in [from, to). Cancelled ones don't count. */
  countReminders(userId: string, from: Date, to: Date): Promise<number>;
  /** false when this bookmark already has one (the unique key did its job). */
  enqueueReminder(r: { userId: string; bookmarkId: string; kind: 'review_48h'; payload: NotificationPayload; sendAfter: Date }): Promise<boolean>;
}

export interface TickStats {
  candidates: number;
  users: number;
  enqueued: number;
  skippedDailyCap: number;
  skippedChecklistDone: number;
  errors: number;
}

export async function runSchedulerTick(deps: { store: SchedulerStore; now?: () => Date; config?: Partial<SchedulerConfig>; onError?: (e: unknown, userId: string) => void }): Promise<TickStats> {
  const cfg = { ...DEFAULT_SCHEDULER_CONFIG, ...deps.config };
  const now = (deps.now ?? (() => new Date()))();
  const stats: TickStats = { candidates: 0, users: 0, enqueued: 0, skippedDailyCap: 0, skippedChecklistDone: 0, errors: 0 };

  const candidates = await deps.store.findReviewCandidates({ afterHours: cfg.afterHours, maxAgeDays: cfg.maxAgeDays, limit: cfg.batchSize });
  stats.candidates = candidates.length;

  const byUser = new Map<string, ReviewCandidate[]>();
  for (const c of candidates) byUser.set(c.userId, [...(byUser.get(c.userId) ?? []), c]);
  stats.users = byUser.size;

  for (const [userId, list] of byUser) {
    try {
      const tz = safeZone(list[0]?.timezone);
      // A checklist the user already ticked off elsewhere needs no nudge.
      const open = list.filter((c) => !(c.totalSteps > 0 && c.openSteps === 0));
      stats.skippedChecklistDone += list.length - open.length;

      // Send inside the user's waking hours, and count the cap against THAT local day.
      const sendAt = nextSendTime(now, tz, cfg.window);
      const dayStart = startOfLocalDay(sendAt, tz);
      const already = await deps.store.countReminders(userId, dayStart, addLocalDays(dayStart, 1, tz));
      const room = Math.max(0, cfg.maxPerUserPerDay - already);
      stats.skippedDailyCap += Math.max(0, open.length - room);

      for (const c of open.slice(0, room)) {
        const created = await deps.store.enqueueReminder({ userId, bookmarkId: c.bookmarkId, kind: 'review_48h', payload: buildReviewPayload(c, sendAt, cfg.deepLinkBase), sendAfter: sendAt });
        if (created) stats.enqueued++;
      }
    } catch (err) {
      stats.errors++; // one user's bad data must not stop everyone else's reminders
      deps.onError?.(err, userId);
    }
  }
  return stats;
}
