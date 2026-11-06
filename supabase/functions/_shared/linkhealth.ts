// Pure logic for the link-health scanner (no Deno or Node globals, so it is unit-tested in Node). I/O is injected.

export const UA = 'BukmarkzLinkCheck/1.0 (+https://bukmarkz.com/bot)';
export const TIMEOUT_MS = 8_000, MAX_HOPS = 5;

/** The only archive address the database accepts (a CHECK constraint enforces the same pattern, so nobody can store a javascript: or phishing URL here). */
export const WAYBACK_RE = /^https:\/\/web\.archive\.org\/web\/[0-9]{1,14}[a-z_]{0,3}\/https?:\/\/.+$/;

export type Outcome = 'ok' | 'hard' | 'soft' | 'skip';
export interface CheckResult { outcome: Outcome; status: number | null; error: string | null }
export type Dns = { addrs: string[] } | { nx: true } | { err: true };
export interface Deps { resolve(host: string): Promise<Dns>; fetch(url: string, init: RequestInit): Promise<Response> }

// ------------------------------------------------------------------ addresses
/** True for loopback, private, link-local (incl. cloud metadata 169.254.169.254), CGNAT, multicast, reserved, and anything unparseable. */
export function isPrivateIp(ip: string): boolean {
  const v = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) {
    const p = v.split('.').map(Number); if (p.some((n) => n > 255)) return true;
    const [a, b] = p;
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0);
  }
  if (v.includes(':')) {
    const m = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); if (m) return isPrivateIp(m[1]);
    const h = v.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/); if (h) { const a = parseInt(h[1], 16), b = parseInt(h[2], 16); return isPrivateIp(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`); }
    if (!/^[0-9a-f:]+$/.test(v)) return true;
    return v === '::' || v === '::1' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || /^ff/.test(v) || /^(64:ff9b|2001:db8|2002:|100:)/.test(v);
  }
  return true;                                                   // not an IP at all
}

/** Parse and vet a URL before we ever connect to it. Returns null for anything we must not fetch. */
export function vetUrl(raw: string): URL | null {
  let u: URL; try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (u.port && !['80', '443', '8080', '8443'].includes(u.port)) return null;
  const h = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan') || !h.includes('.') && !h.includes(':')) return null;
  const lit = h.replace(/^\[|\]$/g, '');
  if ((/^[\d.]+$/.test(lit) || lit.includes(':')) && isPrivateIp(lit)) return null;
  return u;
}

// ------------------------------------------------------------------ HTTP status -> meaning
/** ok: reachable. blocked: reachable but refusing bots (never counted as dead). hard: gone. soft: could be temporary. */
export function classifyStatus(s: number): 'ok' | 'blocked' | 'hard' | 'soft' {
  if ((s >= 200 && s < 400) || s === 416) return 'ok';           // 416: server alive, just dislikes our Range probe
  if (s === 401 || s === 403 || s === 407 || s === 429 || s === 451 || s === 999) return 'blocked';   // 999 = LinkedIn
  if (s === 404 || s === 410) return 'hard';
  return 'soft';                                                  // other 4xx, 5xx
}

const REDIRECT = new Set([301, 302, 303, 307, 308]);
const cancel = (r: Response) => { try { void r.body?.cancel(); } catch { /* ignore */ } };
const errCode = (e: unknown) => ((e as { name?: string })?.name === 'TimeoutError' || (e as { name?: string })?.name === 'AbortError' ? 'timeout' : 'network');

/** Check one saved URL. HEAD first (cheap); any non-OK answer is confirmed with GET because some servers answer HEAD wrongly. Redirects are followed by hand so every hop is vetted. */
export async function checkLink(deps: Deps, raw: string): Promise<CheckResult> {
  let url = vetUrl(raw);
  if (!url) return { outcome: 'skip', status: null, error: 'not_checkable' };
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const dns = await deps.resolve(url.hostname.replace(/^\[|\]$/g, ''));
    if ('nx' in dns) return hop === 0 ? { outcome: 'hard', status: null, error: 'dns_nxdomain' } : { outcome: 'soft', status: null, error: 'redirect_dns' };
    if ('err' in dns) return { outcome: 'soft', status: null, error: 'dns_error' };
    if (!dns.addrs.length || dns.addrs.some(isPrivateIp)) return { outcome: 'skip', status: null, error: 'private_host' };

    const go = (method: 'HEAD' | 'GET') => deps.fetch(url!.toString(), {
      method, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': UA, accept: '*/*', ...(method === 'GET' ? { range: 'bytes=0-0' } : {}) },
    });
    let res: Response | null = null, via: 'HEAD' | 'GET' = 'HEAD', failure = '';
    try { res = await go('HEAD'); } catch (e) { failure = errCode(e); }
    if (res && !REDIRECT.has(res.status) && classifyStatus(res.status) !== 'ok') { cancel(res); res = null; }          // confirm every non-OK HEAD with GET
    if (!res) { try { res = await go('GET'); via = 'GET'; failure = ''; } catch (e) { return { outcome: 'soft', status: null, error: failure || errCode(e) }; } }

    if (REDIRECT.has(res.status)) {
      const loc = res.headers.get('location'); cancel(res);
      let next: URL | null = null; try { next = loc ? vetUrl(new URL(loc, url).toString()) : null; } catch { next = null; }
      if (!next) return { outcome: loc ? 'skip' : 'soft', status: res.status, error: loc ? 'redirect_not_checkable' : 'redirect_no_location' };
      url = next; continue;
    }
    const status = res.status; cancel(res);
    const k = classifyStatus(status);
    if (k === 'ok' || k === 'blocked') return { outcome: 'ok', status, error: k === 'blocked' ? 'blocked_by_site' : null };
    return { outcome: k, status, error: `http_${status}` + (via === 'GET' ? '' : '') };
  }
  return { outcome: 'soft', status: null, error: 'redirect_loop' };
}

// ------------------------------------------------------------------ Wayback Machine
export const waybackLookupUrl = (target: string) => `https://archive.org/wayback/available?url=${encodeURIComponent(target.split('#')[0])}`;

/** Latest usable snapshot from the availability API, or null. Only a 200-status snapshot on web.archive.org is accepted; http is upgraded to https. */
export function parseWayback(j: unknown): { url: string; takenAt: string | null } | null {
  const c = (j as { archived_snapshots?: { closest?: { available?: boolean; status?: string; url?: string; timestamp?: string } } })?.archived_snapshots?.closest;
  if (!c || c.available !== true || String(c.status) !== '200' || typeof c.url !== 'string') return null;
  const url = c.url.replace(/^http:\/\//i, 'https://');
  if (!WAYBACK_RE.test(url) || url.length > 2200) return null;
  const t = c.timestamp?.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  return { url, takenAt: t ? `${t[1]}-${t[2]}-${t[3]}T${t[4]}:${t[5]}:${t[6]}Z` : null };
}
