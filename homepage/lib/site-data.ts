/**
 * Single source of truth for facts that appear BOTH on the page and in the JSON-LD.
 * Google requires structured data to match visible content, so the page and the schema both read from here.
 */
export const SITE_URL = 'https://www.bukmarkz.com';
export const SITE_NAME = 'Bukmarkz AI';

export const PRICE = { proMonthly: 4.99, proAnnual: 39, teamMonthly: 12.99 } as const;
export const TRIAL_MONTHS = 6;
export const SAVE_PERCENT = Math.round((1 - PRICE.proAnnual / (PRICE.proMonthly * 12)) * 100); // 35
export const usd = (n: number) => `$${n.toFixed(2)}`;

export interface FaqItem {
  q: string;
  /** Plain text. It is rendered on the page and copied into the FAQPage markup. */
  a: string;
  /** Included in the FAQPage JSON-LD. Every item is visible on the page either way. */
  inSchema?: boolean;
}

export const FAQS: FaqItem[] = [
  {
    q: 'How do I turn bookmarks into tasks?',
    a: 'Open any saved link, add a quick note, and set a reminder: this evening, tomorrow, in 3 days or next Monday. The page comes back when it matters instead of sitting in a folder. AI action checklists, which break a saved article into three small steps, are coming soon.',
    inSchema: true,
  },
  {
    q: 'Is there a free trial?',
    a: `Yes. New users can claim ${TRIAL_MONTHS} months of Pro free, and no credit card is required. After the trial, Pro is ${usd(PRICE.proMonthly)} per month or ${usd(PRICE.proAnnual).replace('.00', '')} per year. There is also a Free plan.`,
    inSchema: true,
  },
  {
    q: 'Does Bukmarkz work with 1Password and Entra ID SSO?',
    a: 'You can sign in today with an email link, Google or GitHub. Passkey sign-in is coming soon, and passkeys can be stored in password managers that support them, such as 1Password. Microsoft Entra ID single sign-on is not available yet. If you need it for your team, contact sales.',
    inSchema: true,
  },
  {
    q: 'Does it work in Incognito and private windows?',
    a: 'Yes, with one setting: switch on "Allow in Incognito" for the extension in Chrome. Pages you save from a private window are kept on your device only. They are not uploaded to your account and never sent to AI. Their reminders hide the page title in notifications.',
    inSchema: true,
  },
  {
    q: 'Can I save from my phone?',
    a: 'Not yet. iOS and Android share sheets, and saving through WhatsApp or Telegram, are in development. Today you can save from the web app and the Chrome extension on desktop.',
  },
  {
    q: 'Is my data private? Is it encrypted?',
    a: 'Everything travels over HTTPS. Bukmarkz is not end-to-end encrypted, which means your saved content is stored on our servers in a form we can read. Private categories are left out of AI search and are never sent to an AI provider. For your other saves, the page text may be sent to an AI provider to create tags and search embeddings.',
  },
];
