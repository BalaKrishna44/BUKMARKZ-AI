/**
 * Sends the reminders that are due. Delivery itself (FCM, APNs, Expo...) is behind PushSender: plug yours in.
 *
 * Safe to run on several workers: rows are claimed with FOR UPDATE SKIP LOCKED, and a worker that crashes mid-send leaves a
 * "sending" row that is picked up again after 10 minutes.
 */
import type { NotificationPayload } from './scheduler.ts';

export type PushResult =
  | { ok: true }
  | { ok: false; retryable: boolean; reason: string; /** the user has no registered device: cancel, don't retry */ noDevices?: boolean };

export interface PushSender {
  send(userId: string, notification: NotificationPayload): Promise<PushResult>;
}

export interface ClaimedReminder {
  id: string;
  userId: string;
  bookmarkId: string;
  payload: NotificationPayload;
  attempts: number;
}

export interface DispatchStore {
  /** Cancel pending reminders whose bookmark was opened, archived or made private since they were queued. */
  cancelStaleReminders(): Promise<number>;
  claimDueReminders(limit: number): Promise<ClaimedReminder[]>;
  markReminderSent(id: string): Promise<void>;
  markReminderRetry(id: string, sendAfter: Date, error: string): Promise<void>;
  markReminderFailed(id: string, status: 'failed' | 'cancelled', error: string): Promise<void>;
}

export interface DispatchStats {
  cancelled: number;
  sent: number;
  retried: number;
  failed: number;
}

/** 5, 15, 45, 135 minutes ... capped at 4 hours. */
export function retryDelayMinutes(attempts: number): number {
  return Math.min(5 * 3 ** Math.max(0, attempts - 1), 240);
}

export async function runDispatcherTick(deps: { store: DispatchStore; sender: PushSender; now?: () => Date; batchSize?: number; maxAttempts?: number }): Promise<DispatchStats> {
  const now = deps.now ?? (() => new Date());
  const maxAttempts = deps.maxAttempts ?? 5;
  const stats: DispatchStats = { cancelled: 0, sent: 0, retried: 0, failed: 0 };

  // Last chance to stay quiet: the user may have opened the item since the reminder was planned.
  stats.cancelled = await deps.store.cancelStaleReminders();

  for (const r of await deps.store.claimDueReminders(deps.batchSize ?? 50)) {
    let result: PushResult;
    try {
      result = await deps.sender.send(r.userId, r.payload);
    } catch (err) {
      result = { ok: false, retryable: true, reason: err instanceof Error ? err.message : 'send failed' };
    }

    if (result.ok) {
      await deps.store.markReminderSent(r.id);
      stats.sent++;
    } else if (result.noDevices) {
      await deps.store.markReminderFailed(r.id, 'cancelled', 'no registered device');
      stats.cancelled++;
    } else if (result.retryable && r.attempts < maxAttempts) {
      await deps.store.markReminderRetry(r.id, new Date(now().getTime() + retryDelayMinutes(r.attempts) * 60_000), result.reason);
      stats.retried++;
    } else {
      await deps.store.markReminderFailed(r.id, 'failed', result.reason);
      stats.failed++;
    }
  }
  return stats;
}

/** For local development: prints instead of pushing. */
export class ConsolePushSender implements PushSender {
  async send(userId: string, n: NotificationPayload): Promise<PushResult> {
    console.log(`[push -> ${userId}] ${n.title}: ${n.body}`);
    return { ok: true };
  }
}
