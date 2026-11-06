/** Logic for the dashboard Friday banner, kept out of the component so it can be unit-tested. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;   // the viewer's LOCAL date

/** Show on Friday from 12:00 local, or whenever the email button sent them here (?intent=flush). Never again today once dismissed. */
export function shouldShowBanner(now: Date, search: string, dismissedOn: string | null): boolean {
  if (dismissedOn === dayKey(now)) return false;
  const fromEmail = new URLSearchParams(search).get('intent') === 'flush';
  return fromEmail || (now.getDay() === 5 && now.getHours() >= 12);
}
export const SHARE_TEXT = 'Markz: "I have a shortcut to close all my tabs before the weekend!" Buk: "Did you save them, or did your battery die again?" From Bukmarkz, the bookmark manager with an owl who remembers:';
