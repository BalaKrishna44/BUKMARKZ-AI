/** Pure helpers for the "Share this deal" buttons (unit-tested). Nothing here touches affiliate.ts: see the note on cleanShareUrl. */
export interface ShareInput { title: string; url: string; price: number; was: number; currency: string; refCode?: string | null; site?: string }
const SITE = (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SITE_URL || 'https://bukmarkz.com').replace(/\/$/, '');
export const REF_RE = /^[a-z0-9]{8}$/;                                           // same shape as get_or_create_referral_code()

export const money = (n: number, cur: string) => { try { return new Intl.NumberFormat('en', { style: 'currency', currency: cur, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n); } catch { return `${n} ${cur}`; } };
export const dropPercent = (price: number, was: number): number => (was > 0 && price > 0 && price < was ? Math.round(((was - price) / was) * 100) : 0);

/**
 * The link a friend gets is the product page exactly as the shop shows it, minus tracking junk (utm_*, fbclid, gclid). We do NOT add an affiliate tag
 * here: tags are added only by the disclosed Buy button (components/deals/BuyButton.tsx), so a friend is never sent through a hidden commission link.
 * Anything that is not a plain https URL is refused (returns null).
 */
export function cleanShareUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k) || /^(fbclid|gclid|igshid|mc_eid)$/i.test(k)) u.searchParams.delete(k);
  u.hash = '';
  return u.toString().length <= 2048 ? u.toString() : null;
}

export function inviteUrl(refCode: string | null | undefined, site = SITE): string | null {
  return refCode && REF_RE.test(refCode) ? `${site}/?ref=${refCode}` : null;                // the signup flow stores ?ref= (see growth-kit/lib referral flow)
}

export function buildShare(i: ShareInput) {
  const link = cleanShareUrl(i.url), pct = dropPercent(i.price, i.was), invite = inviteUrl(i.refCode, i.site);
  if (!link) return null;
  const title = i.title.replace(/\s+/g, ' ').trim().slice(0, 90) || 'this product';
  const head = pct >= 1 ? `🔥 ${title} dropped ${pct}%: ${money(i.price, i.currency)} (was ${money(i.was, i.currency)})` : `👀 ${title}: ${money(i.price, i.currency)}`;
  const text = [head, link, ...(invite ? ['', `I track prices with Bukmarkz (free): ${invite}`] : [])].join('\n');
  return {
    text, link, invite, pct,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(text)}`,
    telegram: `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent([head, ...(invite ? ['', `I track prices with Bukmarkz (free): ${invite}`] : [])].join('\n'))}`,
  };
}
