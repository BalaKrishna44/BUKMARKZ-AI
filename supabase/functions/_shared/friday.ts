// Pure helpers for "Friday Vault After-Hours" (no Deno-only APIs, so node:test can run them). Shares signing/bearer helpers with digest.ts.
import { isoWeek } from './digest.ts';

export type Who = 'markz' | 'buk';
export interface Turn { who: Who; text: string }
export type JokeSource = 'pool' | 'ai' | 'manual';

/** ISO week key such as "2026-W44". Uses the ISO week-YEAR (the last days of December can belong to week 1 of the next year). */
export function weekKey(d = new Date()): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  return `${t.getUTCFullYear()}-W${String(isoWeek(d)).padStart(2, '0')}`;
}

const T = (...lines: [Who, string][]): Turn[] => lines.map(([who, text]) => ({ who, text }));
/** Curated, human-written, safe-for-work. Used when AI is off, fails validation, or a person blocks this week's AI joke. Picked by week number. */
export const JOKE_POOL: Turn[][] = [
  T(['markz', 'I have 47 tabs open and I am ONLY keeping them for research.'], ['buk', 'Research has a half-life. Yours expired in March.'], ['markz', 'Some of them are from March?!'], ['buk', 'Some are from the March before that.']),
  T(['markz', 'Buk! I finally organized my bookmarks. Folders, colour codes, everything.'], ['buk', 'Impressive. How many have you opened since?'], ['markz', '...Organizing WAS the project.'], ['buk', 'Then the project is complete. Ship it.']),
  T(['markz', 'I fixed the bug by adding a console.log.'], ['buk', 'Which one?'], ['markz', 'The log. Without it, everything works.'], ['buk', 'That is not a fix. That is a Heisenbug with a good publicist.']),
  T(['markz', 'Friday deploy?'], ['buk', 'No.'], ['markz', 'It is a tiny change!'], ['buk', 'Every outage report begins with that sentence.']),
  T(['markz', 'I saved a tutorial called "Learn Rust in One Weekend".'], ['buk', 'Which weekend?'], ['markz', 'The one I am planning.'], ['buk', 'Ah, Next Weekend. Excellent library. Nobody has ever visited.']),
  T(['markz', 'Why do you answer every question with a source?'], ['buk', 'Because "I read it somewhere" is how bugs are born.'], ['markz', 'I read that somewhere.'], ['buk', 'Where?'], ['markz', '...A tab.']),
  T(['markz', 'My code works and I do not know why.'], ['buk', 'And the other kind?'], ['markz', 'It does not work and I do not know why.'], ['buk', 'At least you are consistent. Check the cache.']),
  T(['markz', 'I am closing every tab right now. Watch me.'], ['buk', 'I will wait.'], ['markz', '...One of them is playing music.'], ['buk', 'One of them is always playing music.'], ['markz', 'WHERE?!'], ['buk', 'Eleventh from the left. Since Tuesday.']),
  T(['markz', 'I bookmarked "The Ultimate Guide to Productivity".'], ['buk', 'Have you read it?'], ['markz', 'I am saving it for when I have time.'], ['buk', 'That page is a guide to exactly that mistake.']),
  T(['markz', 'Standup in five! What did I do yesterday?'], ['buk', 'You opened nineteen tabs about caching.'], ['markz', 'And today?'], ['buk', 'Nineteen more. Progress is sometimes lateral.']),
  T(['markz', 'Everything is a database if you are brave enough.'], ['buk', 'Everything is also a spreadsheet if you are tired enough.'], ['markz', 'So we agree!'], ['buk', 'We agree that it is Friday.']),
  T(['markz', 'Buk, I think I found the root cause!'], ['buk', 'Is it DNS?'], ['markz', 'It is DNS.'], ['buk', 'It is always DNS. Go home, Markz.']),
];
export const poolJoke = (week: string): Turn[] => JOKE_POOL[(Number(week.slice(-2)) || 0) % JOKE_POOL.length];

// ------------------------------------------------------------------ validation (applies to AI AND manual jokes; the pool is tested against it too)
const BAD = /(https?:|www\.|\.com\b|@|<|>|`|\[|\]|\bfuck|\bshit|\bbitch|\bcunt|\bnigg|\bfag|\bretard|\brape|\bsuicid|\bkill (your|my)self|\bnazi|\bporn|\bsex\b|\bdrunk|\bpolitic|\belection|\breligio)/i;
export function validateJoke(v: unknown): Turn[] | null {
  if (!Array.isArray(v) || v.length < 4 || v.length > 6) return null;
  const out: Turn[] = [];
  for (let i = 0; i < v.length; i++) {
    const t = v[i] as { who?: unknown; text?: unknown };
    if (!t || (t.who !== 'markz' && t.who !== 'buk') || typeof t.text !== 'string') return null;
    const text = t.text.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length < 2 || text.length > 170 || BAD.test(text)) return null;
    if (i > 0 && out[i - 1].who === t.who) return null;                 // a skit, not a monologue: speakers alternate
    out.push({ who: t.who, text });
  }
  return out[0].who === 'markz' ? out : null;                            // Markz opens
}

export function jokePrompt(week: string, recent: string[]) {
  return {
    system: 'You write one tiny comedy skit for a developer-tools newsletter, between two mascots. '
      + 'MARKZ is energetic, a little goofy and relatable: a developer/knowledge worker who hoards browser tabs and bookmarks. '
      + 'BUK is a calm, wise, deadpan owl who runs the search engine and answers briefly and precisely. '
      + 'Rules: 4 to 6 lines, alternating, Markz speaks first, each line under 140 characters. Gentle, warm, workplace-safe humour about tabs, bookmarks, deadlines, Friday deploys, debugging, '
      + 'forgetting what you saved. NEVER mention politics, religion, sex, alcohol, violence, real people, real companies or brands, and never include links or emails. No emoji. '
      + 'Reply with JSON only: {"turns":[{"who":"markz","text":"..."},{"who":"buk","text":"..."}]}',
    user: `Week ${week}. Write a fresh skit. Do not reuse the premise of these recent ones: ${JSON.stringify(recent.slice(0, 3))}`,
  };
}
export function parseModelJoke(text: string): Turn[] | null {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return validateJoke((JSON.parse(text.slice(a, b + 1)) as { turns?: unknown }).turns); } catch { return null; }
}

// ------------------------------------------------------------------ email text
export const subjectFor = () => 'Friday Vault After-Hours: Markz and Buk have clocked out';
export const FRIDAY_REWARD = 'You both get 30 days of Pro once they save their first 5 links.';
export function shareMailto(turns: Turn[], signupUrl: string): string {
  const body = `${turns.map((t) => `${t.who === 'markz' ? 'Markz' : 'Buk'}: ${t.text}`).join('\n')}\n\nFrom Bukmarkz, the bookmark manager with an owl who actually remembers: ${signupUrl}`;
  return `mailto:?subject=${encodeURIComponent('A joke from Markz and Buk')}&body=${encodeURIComponent(body)}`;
}
export function plainText(o: { turns: Turn[]; ctaUrl: string; ctaLabel: string; signupUrl: string; unsubscribeUrl: string; weekSaves: number }): string {
  return ['FRIDAY VAULT AFTER-HOURS', '', ...o.turns.map((t) => `${t.who === 'markz' ? 'Markz' : 'Buk'}: ${t.text}`), '',
    o.weekSaves > 0 ? `You saved ${o.weekSaves} link${o.weekSaves === 1 ? '' : 's'} this week.` : '', `${o.ctaLabel}: ${o.ctaUrl}`, '',
    `Share this with a friend: ${o.signupUrl}`, FRIDAY_REWARD, '', `You get this on Fridays because you turned it on. Unsubscribe in one click: ${o.unsubscribeUrl}`, ''].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}

/** Same HMAC scheme as digest.ts signUser, with its own namespace so a digest link can never switch off the Friday email (or the reverse). */
export async function signFriday(uid: string, secret: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`friday:${uid}`)))].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export async function fridayUnsubscribeUrl(site: string, uid: string, secret: string) {
  return `${site}/api/friday/unsubscribe?u=${encodeURIComponent(uid)}&t=${await signFriday(uid, secret)}`;
}
export async function sha256Hex(s: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, '0')).join('');
}
