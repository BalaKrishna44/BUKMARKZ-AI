/**
 * Trust-first affiliate links.
 *
 *  - The database is never touched: this module only builds a string at render time, and only for the "Buy" button of the deals UI
 *    (components/deals/BuyButton.tsx is its only caller; test/unit.test.ts fails if anything else imports it, e.g. emails, exports, the API).
 *  - Pro users (and anyone whose plan we could not confirm) get the original URL, byte for byte.
 *  - Free users get an approved affiliate parameter on merchants we have a program for, plus a visible disclosure and rel="sponsored".
 *  - An existing affiliate parameter in the saved link is respected, never replaced. Lookalike hosts are never tagged.
 *
 * Programs come from the environment so no ID is hard-coded:
 *   AFFILIATE_TAGS='{"amazon.in":{"tag":"yourid-21"},"amazon.com":{"tag":"yourid-20"},"flipkart.com":{"affid":"yourid"}}'
 * (one parameter per merchant host). Use each program's own approved parameter and read its terms before launching.
 */
export const AFFILIATE_DISCLOSURE = 'Bukmarkz earns a commission if you buy here.';

export interface Program { host: string; param: string; value: string }
const HOST_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}(?:\.[a-z]{2})?$/;
const PARAM_RE = /^[A-Za-z][A-Za-z0-9_]{0,29}$/, VALUE_RE = /^[A-Za-z0-9._-]{1,60}$/;

export function parsePrograms(raw: string | undefined): Program[] {
  if (!raw) return [];
  let o: unknown;
  try { o = JSON.parse(raw); } catch { return []; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return [];
  const out: Program[] = [];
  for (const [host, cfg] of Object.entries(o as Record<string, unknown>)) {
    const h = host.toLowerCase();
    if (!HOST_RE.test(h) || !cfg || typeof cfg !== 'object') continue;
    const entries = Object.entries(cfg as Record<string, unknown>);
    if (entries.length !== 1) continue;                                        // exactly one parameter per merchant
    const [param, value] = entries[0];
    if (typeof value === 'string' && PARAM_RE.test(param) && VALUE_RE.test(value)) out.push({ host: h, param, value });
  }
  return out;
}
const envPrograms = (): Program[] => parsePrograms(typeof process !== 'undefined' ? process.env.AFFILIATE_TAGS : undefined);

const hostMatches = (hostname: string, program: string) => {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  return h === program || h === `www.${program}` || h === `m.${program}`;           // exact merchant host only: no wildcard subdomains, no lookalikes
};

/**
 * Returns the URL to put behind a Buy button.
 * `isProUser` must be exactly `false` for a link to be changed: `true`, `undefined` ("could not tell") and anything else return the original.
 */
export function getMonetizedUrl(originalUrl: string, isProUser: boolean, programs: Program[] = envPrograms()): string {
  if (isProUser !== false) return originalUrl;
  let u: URL;
  try { u = new URL(originalUrl); } catch { return originalUrl; }
  if (u.protocol !== 'https:' || u.username || u.password) return originalUrl;
  const program = programs.find((p) => hostMatches(u.hostname, p.host));
  if (!program) return originalUrl;
  if ([...u.searchParams.keys()].some((k) => k.toLowerCase() === program.param.toLowerCase())) return originalUrl;     // keep whatever tag is already there
  u.searchParams.append(program.param, program.value);
  const out = u.toString();
  return out.length <= 2048 ? out : originalUrl;
}

export interface BuyLink { href: string; monetized: boolean; rel: string; disclosure: string | null }
/** What the Buy button renders. `disclosure` is non-null exactly when the href differs from the saved URL. */
export function getBuyLink(originalUrl: string, isProUser: boolean, programs?: Program[]): BuyLink {
  const href = getMonetizedUrl(originalUrl, isProUser, programs);
  const monetized = href !== originalUrl;
  return { href, monetized, rel: monetized ? 'sponsored nofollow noopener noreferrer' : 'noopener noreferrer', disclosure: monetized ? AFFILIATE_DISCLOSURE : null };
}
