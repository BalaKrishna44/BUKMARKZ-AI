import { checkLink, classifyStatus, isPrivateIp, vetUrl, parseWayback, WAYBACK_RE, type Deps, type Dns } from '../../supabase/functions/_shared/linkhealth';
let fails = 0; const ok = (c: unknown, m: string) => { if (!c) { fails++; console.log('FAIL:', m); } else console.log('ok -', m); };
const R = (status: number, headers: Record<string, string> = {}) => new Response(null, { status: status === 204 ? 204 : status, headers });
function mk(routes: Record<string, (m: string) => Response | Error>, dns: Record<string, Dns> = {}) {
  const calls: string[] = [];
  const d: Deps = {
    resolve: async (h) => dns[h] ?? { addrs: ['93.184.216.34'] },
    fetch: async (u, init) => { const m = String(init.method); calls.push(m + ' ' + u); const r = (routes[u] ?? (() => R(404)))(m); if (r instanceof Error) throw r; return r; },
  };
  return { d, calls };
}
(async () => {
  ok(['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.0.1', '172.16.0.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '0.0.0.0', 'garbage'].every(isPrivateIp), 'private addresses detected');
  ok(!['93.184.216.34', '8.8.8.8', '2606:4700::1111', '172.32.0.1'].some(isPrivateIp), 'public addresses allowed');
  ok(['ftp://a.com', 'http://localhost/', 'http://x.local/', 'http://u:p@a.com/', 'http://a.com:22/', 'http://intranet/', 'http://127.0.0.1/', 'http://[::1]/', 'http://2130706433/', 'javascript:alert(1)', 'bukmarkz://voice/x'].every((u) => vetUrl(u) === null), 'unsafe URLs rejected');
  ok(vetUrl('https://example.com:8443/a?b#c') !== null, 'normal URL accepted');
  ok([200, 301, 304, 416].every((s) => classifyStatus(s) === 'ok') && [401, 403, 429, 451, 999].every((s) => classifyStatus(s) === 'blocked') && classifyStatus(404) === 'hard' && classifyStatus(410) === 'hard' && classifyStatus(500) === 'soft' && classifyStatus(503) === 'soft' && classifyStatus(400) === 'soft', 'status classes');

  let t = mk({ 'https://a.com/': () => R(200) }); let r = await checkLink(t.d, 'https://a.com/');
  ok(r.outcome === 'ok' && t.calls.length === 1 && t.calls[0].startsWith('HEAD'), 'HEAD 200 = ok, one request');
  t = mk({ 'https://a.com/': (m) => m === 'HEAD' ? R(404) : R(200) }); r = await checkLink(t.d, 'https://a.com/');
  ok(r.outcome === 'ok' && t.calls.length === 2, 'HEAD 404 but GET 200 = ok (server mishandles HEAD)');
  t = mk({ 'https://a.com/': () => R(404) }); r = await checkLink(t.d, 'https://a.com/');
  ok(r.outcome === 'hard' && r.status === 404 && r.error === 'http_404', '404 both = hard');
  t = mk({ 'https://a.com/': () => R(503) }); r = await checkLink(t.d, 'https://a.com/');
  ok(r.outcome === 'soft' && r.status === 503, '503 = soft');
  t = mk({ 'https://a.com/': () => R(403) }); r = await checkLink(t.d, 'https://a.com/');
  ok(r.outcome === 'ok' && r.error === 'blocked_by_site', '403 = alive (bot-blocked)');
  t = mk({ 'https://a.com/': () => Object.assign(new Error('x'), { name: 'TimeoutError' }) }); r = await checkLink(t.d, 'https://a.com/');
  ok(r.outcome === 'soft' && r.error === 'timeout', 'timeout = soft');
  t = mk({}, { 'a.com': { nx: true } }); r = await checkLink(t.d, 'https://a.com/');
  ok(r.outcome === 'hard' && r.error === 'dns_nxdomain' && t.calls.length === 0, 'NXDOMAIN = hard, no fetch');
  t = mk({}, { 'a.com': { err: true } }); r = await checkLink(t.d, 'https://a.com/');
  ok(r.outcome === 'soft' && r.error === 'dns_error', 'DNS failure = soft');
  t = mk({}, { 'evil.com': { addrs: ['93.184.216.34', '10.0.0.5'] } }); r = await checkLink(t.d, 'https://evil.com/');
  ok(r.outcome === 'skip' && t.calls.length === 0, 'any private A record = skip, no fetch');
  t = mk({ 'https://a.com/': () => R(301, { location: '/b' }), 'https://a.com/b': () => R(200) }); r = await checkLink(t.d, 'https://a.com/');
  ok(r.outcome === 'ok' && t.calls.length === 2, 'relative redirect followed');
  t = mk({ 'https://a.com/': () => R(302, { location: 'http://169.254.169.254/latest' }) }); r = await checkLink(t.d, 'https://a.com/');
  ok(r.outcome === 'skip' && t.calls.length === 1, 'redirect to metadata IP is not followed');
  t = mk({ 'https://a.com/': () => R(302, { location: 'https://rebind.com/' }) }, { 'rebind.com': { addrs: ['127.0.0.1'] } }); r = await checkLink(t.d, 'https://a.com/');
  ok(r.outcome === 'skip' && t.calls.length === 1, 'redirect to host resolving privately is not fetched');
  t = mk({ 'https://a.com/': () => R(302, { location: 'https://a.com/' }) }); r = await checkLink(t.d, 'https://a.com/');
  ok(r.outcome === 'soft' && r.error === 'redirect_loop', 'redirect loop = soft');
  t = mk({}); r = await checkLink(t.d, 'http://localhost:3000/');
  ok(r.outcome === 'skip' && t.calls.length === 0, 'localhost skipped');

  const snap = { archived_snapshots: { closest: { available: true, status: '200', url: 'http://web.archive.org/web/20240131120000/https://a.com/x', timestamp: '20240131120000' } } };
  const w = parseWayback(snap);
  ok(w?.url === 'https://web.archive.org/web/20240131120000/https://a.com/x' && w.takenAt === '2024-01-31T12:00:00Z', 'wayback parsed, upgraded to https');
  ok(parseWayback({ archived_snapshots: {} }) === null, 'no snapshot = null');
  const bad = (u: string, extra = {}) => parseWayback({ archived_snapshots: { closest: { available: true, status: '200', url: u, timestamp: '20240101000000', ...extra } } });
  ok(bad('https://evil.com/web/20240131120000/https://a.com/') === null && bad('javascript:alert(1)') === null && bad('https://web.archive.org.evil.com/web/2024/https://a.com') === null, 'non-archive URLs rejected');
  ok(bad('https://web.archive.org/web/2024/https://a.com/', { status: '404' }) === null && parseWayback(null) === null, 'non-200 snapshot / junk rejected');
  ok(WAYBACK_RE.test('https://web.archive.org/web/20240131120000id_/https://a.com/'), 'id_ flavour accepted');
  console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
