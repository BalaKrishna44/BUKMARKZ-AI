// Plain-language reason a link was resurfaced. Pure (shared by the API and the card).
export interface Pick { id: string; unread: boolean; days_since: number; sim: number | null; score?: number }

export function ago(days: number): string {
  if (days < 14) return `${Math.max(1, Math.round(days))} day${Math.round(days) === 1 ? '' : 's'}`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  if (days < 730) return `${Math.round(days / 30)} months`;
  return `${Math.round(days / 365)} years`;
}
export function whyText(p: Pick, createdAt?: string, now: Date = new Date()): string {
  const parts: string[] = [];
  const saved = createdAt ? Math.floor((now.getTime() - Date.parse(createdAt)) / 864e5) : null;
  if (p.unread) parts.push(saved != null && saved >= 7 ? `Saved ${ago(saved)} ago, never opened` : 'Never opened');
  else parts.push(`Not opened in ${ago(p.days_since)}`);
  if (p.sim != null && p.sim >= 0.5) parts.push('related to this week’s saves');
  return parts.join(' · ');
}
