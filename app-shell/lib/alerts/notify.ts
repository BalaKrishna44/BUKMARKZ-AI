/**
 * Deliver price alerts. Email (Resend) and web push are independent channels; an alert counts as delivered if EITHER works.
 * If every channel fails the claim is released (price_release_claim), so the next observation retries instead of silently burning the 7-day cooldown.
 */
export interface Claim { watch_id: string; user_id: string; item_id: string; target_price: number | string; currency: string; prior_alert_at: string | null; title: string | null; url: string; email: string | null; own: boolean }
export interface Alert { claim: Claim; price: number; medianPrice: number | null }
export interface Channels {
  email?(a: Alert): Promise<boolean>;
  push?(a: Alert): Promise<boolean>;
}
export interface NotifyDb { rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: { message: string } | null }> }

export const money = (n: number, cur: string) => { try { return new Intl.NumberFormat('en', { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(n); } catch { return `${n.toFixed(2)} ${cur}`; } };

async function pool<T>(items: T[], size: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (i < items.length) { const x = items[i++]; await fn(x); } }));
}

export async function dispatchAlerts(claims: Claim[], price: number, medianPrice: number | null, ch: Channels, db: NotifyDb): Promise<{ sent: number; released: number }> {
  let sent = 0, released = 0;
  await pool(claims, 8, async (claim) => {
    const alert: Alert = { claim, price, medianPrice };
    const tried: string[] = [], worked: string[] = [];
    for (const [name, fn] of [['email', ch.email], ['push', ch.push]] as const) {
      if (!fn) continue;
      tried.push(name);
      try { if (await fn.call(ch, alert)) worked.push(name); } catch (e) { console.error('alert channel failed', name, (e as Error).message); }       // message only: never addresses or payloads
    }
    const ok = worked.length > 0;
    try {
      if (!ok) { await db.rpc('price_release_claim', { p_watch: claim.watch_id, p_prior: claim.prior_alert_at }); released++; } else sent++;
      await db.rpc('price_log_alert', { p_watch: claim.watch_id, p_user: claim.user_id, p_price: price, p_currency: claim.currency, p_channels: ok ? worked : tried, p_status: ok ? 'sent' : 'failed' });
    } catch (e) { console.error('alert bookkeeping failed', (e as Error).message); }
  });
  return { sent, released };
}
