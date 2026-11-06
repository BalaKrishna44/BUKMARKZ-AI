import { buildDigest, unsubscribeUrl, type DigestItem } from './build';

/** Everything the job touches is injected, so the logic is testable without Supabase or Resend. */
export interface DigestDeps {
  site: string;
  claim(limit: number): Promise<{ user_id: string; last_item_ids: string[] }[]>;
  pick(userId: string, exclude: string[]): Promise<DigestItem[]>;
  emailOf(userId: string): Promise<string | null>;
  send(msg: { to: string; subject: string; text: string; html: string; unsub: string; key: string }): Promise<boolean>;
  record(userId: string, ids: string[]): Promise<void>;
  release(userId: string): Promise<void>;
  now?: () => Date;
}
export interface DigestReport { claimed: number; sent: number; skippedFewLinks: number; noEmail: number; failed: number }

export async function runDigest(d: DigestDeps, limit = 200, budgetMs = 50_000): Promise<DigestReport> {
  const t0 = Date.now(); const rep: DigestReport = { claimed: 0, sent: 0, skippedFewLinks: 0, noEmail: 0, failed: 0 };
  const users = await d.claim(limit); rep.claimed = users.length;
  for (const [n, u] of users.entries()) {
    if (Date.now() - t0 > budgetMs) { for (const r of users.slice(n)) await d.release(r.user_id).catch(() => {}); rep.failed += users.length - n; break; } // out of time: hand the rest back
    try {
      const to = await d.emailOf(u.user_id);
      if (!to) { rep.noEmail++; continue; }
      const items = await d.pick(u.user_id, u.last_item_ids ?? []);
      const unsub = unsubscribeUrl(d.site, u.user_id);
      const m = buildDigest(items, d.site, unsub, d.now?.());
      if (!m) { rep.skippedFewLinks++; continue; }
      const ok = await d.send({ to, subject: m.subject, text: m.text, html: m.html, unsub, key: `digest-${u.user_id}-${(d.now?.() ?? new Date()).toISOString().slice(0, 10)}` });
      if (ok) { await d.record(u.user_id, m.ids); rep.sent++; } else { await d.release(u.user_id); rep.failed++; }
    } catch { await d.release(u.user_id).catch(() => {}); rep.failed++; }
  }
  return rep;
}
