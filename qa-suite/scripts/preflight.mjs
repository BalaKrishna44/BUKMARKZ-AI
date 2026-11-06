#!/usr/bin/env node
// Production pre-flight probe for Bukmarkz.  Node 20+, zero dependencies.
//   node scripts/preflight.mjs https://bukmarkz.com [--sender-domain=bukmarkz.com] [--build-dir=.next] [--cron-paths=/api/cron/prices,/api/cron/digest] [--env-file=.env.production]
// Exit code 1 if any FAIL. WARN = judgement call. Safe to run against production: only GETs, plus POSTs that are *meant* to be rejected (no token / bad signature).
import dns from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) ?? '').split('=').slice(1).join('=') || d;
if (!target) { console.error('usage: preflight.mjs <https://site> [--sender-domain=] [--build-dir=] [--cron-paths=] [--env-file=]'); process.exit(2); }
const base = new URL(target); const host = base.hostname; const isLocal = /^(localhost|127\.|\[::1\])/.test(host);
const results = []; const rec = (level, id, msg) => { results.push(level); console.log(`${{ PASS: '\x1b[32mPASS\x1b[0m', FAIL: '\x1b[31mFAIL\x1b[0m', WARN: '\x1b[33mWARN\x1b[0m', SKIP: 'SKIP' }[level]}  ${id.padEnd(4)} ${msg}`); };
const check = (id, ok, pass, fail, level = 'FAIL') => rec(ok ? 'PASS' : level, id, ok ? pass : fail);
const get = (p, init = {}) => fetch(new URL(p, base), { redirect: 'manual', ...init });

// ---------------------------------------------------------------- 1. transport: HTTPS, redirect, certificate, TLS version
console.log('\n[1] HTTPS / SSL');
if (isLocal) rec('SKIP', '1.x', 'local target: TLS and redirect checks skipped');
else {
  try { const r = await fetch(`http://${host}/`, { redirect: 'manual' }); const loc = r.headers.get('location') ?? ''; check('1.1', [301, 308].includes(r.status) && loc.startsWith('https://'), `http:// redirects permanently to ${loc}`, `http:// answered ${r.status} ${loc} (want 301/308 -> https)`); }
  catch (e) { rec('WARN', '1.1', `port 80 not reachable (${e.cause?.code ?? e.message}); fine only if HSTS-preloaded and you never expect http links`); }
  await new Promise((res) => {
    const s = tls.connect({ host, port: Number(base.port) || 443, servername: host, rejectUnauthorized: true }, () => {
      const c = s.getPeerCertificate(); const days = Math.floor((new Date(c.valid_to).getTime() - Date.now()) / 864e5);
      check('1.2', s.authorized, 'certificate chain is valid for this hostname', `certificate rejected: ${s.authorizationError}`);
      check('1.3', days > 14, `certificate expires in ${days} days`, `certificate expires in ${days} days: renew now`, days > 3 ? 'WARN' : 'FAIL');
      check('1.4', ['TLSv1.2', 'TLSv1.3'].includes(s.getProtocol()), `negotiated ${s.getProtocol()}`, `negotiated ${s.getProtocol()}`); s.end(); res();
    }); s.on('error', (e) => { rec('FAIL', '1.2', `TLS handshake failed: ${e.message}`); res(); });
  });
  // old protocols must be refused
  await new Promise((res) => { const s = tls.connect({ host, port: 443, servername: host, maxVersion: 'TLSv1.1', minVersion: 'TLSv1', rejectUnauthorized: false, ciphers: 'DEFAULT@SECLEVEL=0' }, () => { rec('FAIL', '1.5', `server still accepts ${s.getProtocol()}`); s.end(); res(); }); s.on('error', (e) => { /^(ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|EHOSTUNREACH)$/.test(e.code ?? '') ? rec('WARN', '1.5', `could not test legacy TLS (${e.code})`) : rec('PASS', '1.5', 'TLS 1.0/1.1 refused'); res(); }); });
}

// ---------------------------------------------------------------- 2. headers
console.log('\n[2] Security headers (home page)');
let home; try { home = await get('/'); } catch (e) { rec('FAIL', '2.0', `cannot reach ${base.origin}: ${e.cause?.code ?? e.message}`); console.log('\nnothing else can be checked'); process.exit(1); }
const H = (k) => home.headers.get(k) ?? '';
const csp = H('content-security-policy'); const dir = (n) => (csp.split(';').map((s) => s.trim()).find((s) => s.startsWith(n + ' ')) ?? '').split(/\s+/).slice(1);
check('2.1', !!csp, 'Content-Security-Policy present', 'Content-Security-Policy missing');
if (csp) {
  const sc = dir('script-src').length ? dir('script-src') : dir('default-src');
  check('2.2', !sc.includes("'unsafe-eval'") && !(sc.includes("'unsafe-inline'") && !sc.some((x) => x.startsWith("'nonce-"))), "script-src has no unsafe-eval and no bare unsafe-inline", "script-src allows unsafe-eval or unsafe-inline without a nonce: XSS protection is void");
  check('2.3', dir('frame-ancestors').includes("'none'") || dir('frame-ancestors').includes("'self'"), 'frame-ancestors restricts framing (clickjacking)', 'frame-ancestors missing');
  check('2.4', dir('object-src').includes("'none'") && (dir('base-uri').includes("'none'") || dir('base-uri').includes("'self'")), "object-src 'none' and base-uri locked", "object-src/base-uri not locked");
  check('2.5', !/(^|\s)(\*|https:|http:)(\s|;|$)/.test(sc.join(' ')), 'script-src has no wildcard / scheme-wide source', 'script-src contains * / https: / http:');
}
const hsts = H('strict-transport-security'); const age = Number(/max-age=(\d+)/.exec(hsts)?.[1] ?? 0);
if (isLocal) rec('SKIP', '2.6', 'HSTS is only sent over HTTPS'); else check('2.6', age >= 31536000 && /includeSubDomains/i.test(hsts), `HSTS: ${hsts}`, `HSTS missing/weak (${hsts || 'absent'}): want max-age>=31536000; includeSubDomains`);
check('2.7', H('x-content-type-options').toLowerCase() === 'nosniff', 'X-Content-Type-Options: nosniff', 'X-Content-Type-Options missing');
check('2.8', /strict-origin|no-referrer|same-origin/.test(H('referrer-policy')), `Referrer-Policy: ${H('referrer-policy')}`, 'Referrer-Policy missing (saved-link URLs can leak to third parties)');
check('2.9', !H('x-powered-by'), 'X-Powered-By not sent', `X-Powered-By: ${H('x-powered-by')} (set poweredByHeader:false)`, 'WARN');
check('2.10', !/\d+\.\d+/.test(H('server')), `Server header does not leak a version (${H('server') || 'absent'})`, `Server header leaks a version: ${H('server')}`, 'WARN');
check('2.11', !!H('permissions-policy'), 'Permissions-Policy present', 'Permissions-Policy missing', 'WARN');
const apiHead = await get('/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
check('2.12', /no-store/.test(apiHead.headers.get('cache-control') ?? ''), 'API responses are Cache-Control: no-store', 'API response is cacheable (a CDN could cache a per-user answer)');

// ---------------------------------------------------------------- 3. machine endpoints must reject strangers
console.log('\n[3] Endpoints that must refuse anonymous callers');
const mustRefuse = async (id, p, init, want, label) => { try { const r = await get(p, init); check(id, want.includes(r.status), `${label} -> ${r.status}`, `${label} -> ${r.status} (want ${want.join('/')})`); } catch (e) { rec('FAIL', id, `${label}: ${e.message}`); } };
await mustRefuse('3.1', '/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' }, [401], 'POST /api/mcp without a token');
await mustRefuse('3.2', '/api/mcp/org', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' }, [401], 'POST /api/mcp/org without a token');
await mustRefuse('3.3', '/api/webhooks/stripe', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' }, body: '{"id":"evt_preflight","type":"customer.subscription.updated"}' }, [400, 401, 403], 'POST /api/webhooks/stripe with a forged signature');
await mustRefuse('3.4', '/api/webhooks/stripe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, [400, 401, 403], 'POST /api/webhooks/stripe with no signature');
await mustRefuse('3.5', '/api/ingest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"url":"https://example.com"}' }, [401], 'POST /api/ingest (extension) without a token');
for (const p of (opt('cron-paths', '/api/cron/prices').split(',').filter(Boolean))) {
  await mustRefuse('3.6', p, {}, [401, 403, 404, 405], `GET ${p} without CRON_SECRET`);
  await mustRefuse('3.7', p, { headers: { authorization: 'Bearer wrong-secret' } }, [401, 403, 404, 405], `GET ${p} with a wrong secret`);
}
await mustRefuse('3.8', '/dashboard', {}, [302, 303, 307, 308], 'GET /dashboard signed out redirects to login');
await mustRefuse('3.9', '/.env', {}, [404], 'GET /.env'); await mustRefuse('3.10', '/.git/config', {}, [404], 'GET /.git/config');

// ---------------------------------------------------------------- 4. secrets in the client bundle
console.log('\n[4] Secret leakage (NEXT_PUBLIC_ and bundles)');
const SECRET_PATTERNS = [
  ['Stripe secret key', /sk_(live|test)_[A-Za-z0-9]{16,}/], ['Stripe restricted key', /rk_(live|test)_[A-Za-z0-9]{16,}/], ['Stripe webhook secret', /whsec_[A-Za-z0-9]{16,}/],
  ['Resend API key', /\bre_[A-Za-z0-9]{20,}\b/], ['OpenAI key', /sk-(proj-)?[A-Za-z0-9_-]{32,}/], ['Anthropic key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['Bukmarkz MCP/org token', /buk_(mcp|org)_[A-Za-z0-9_-]{43}/], ['private key block', /-----BEGIN (RSA |EC )?PRIVATE KEY-----/], ['AWS access key', /AKIA[0-9A-Z]{16}/],
  ['env var name of a secret', /(SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET_KEY|CRON_SECRET|ALERT_SIGNING_SECRET|VAPID_PRIVATE_KEY)/],
];
const jwtRole = (t) => { try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).role; } catch { return null; } };
function scanText(label, text) {
  let bad = 0;
  for (const [name, re] of SECRET_PATTERNS) if (re.test(text)) { rec('FAIL', '4.1', `${label}: looks like a ${name}`); bad++; }
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) { const role = jwtRole(m[0]); if (role && role !== 'anon') { rec('FAIL', '4.2', `${label}: contains a JWT with role "${role}" (only the anon key may ship to browsers)`); bad++; } }
  return bad;
}
if (opt('build-dir', '')) {
  const dirp = path.join(opt('build-dir', '.next'), 'static'); let n = 0, bad = 0;
  (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(js|css|html|json|map)$/.test(f.name)) { n++; bad += scanText(p, fs.readFileSync(p, 'utf8')); } } })(dirp);
  check('4.3', bad === 0, `scanned ${n} files in ${dirp}: no secret patterns`, `${bad} secret pattern(s) in the build output`);
}
const envFile = opt('env-file', '');
if (envFile) {
  const names = fs.readFileSync(envFile, 'utf8').split('\n').map((l) => /^\s*(NEXT_PUBLIC_[A-Z0-9_]+)\s*=/.exec(l)?.[1]).filter(Boolean);
  const risky = names.filter((n) => /(SECRET|SERVICE|PRIVATE|PASSWORD|TOKEN|WEBHOOK|_SK\b|API_KEY|SIGNING)/.test(n) && !/ANON/.test(n));
  check('4.4', risky.length === 0, `NEXT_PUBLIC_ variables: ${names.join(', ') || 'none'} (all look public by design)`, `these NEXT_PUBLIC_ names look like secrets and WILL be embedded in the browser bundle: ${risky.join(', ')}`);
}
{
  const html = await (await get('/')).text(); const assets = [...new Set([...html.matchAll(/\/_next\/static\/[^"'\\\s)]+\.js/g)].map((m) => m[0]))].slice(0, 40);
  let bad = scanText('home HTML', html); let maps = 0;
  for (const a of assets) { try { const t = await (await get(a)).text(); bad += scanText(a, t); const m = await get(a + '.map'); if (m.status === 200 && (m.headers.get('content-type') ?? '').includes('json')) maps++; } catch { /* ignore */ } }
  check('4.5', bad === 0, `${assets.length} live JS chunks scanned: no secret patterns, no service-role JWT`, `${bad} secret pattern(s) in what browsers download`);
  check('4.6', maps === 0, 'no public source maps', `${maps} source map(s) are publicly downloadable (productionBrowserSourceMaps:false)`, 'WARN');
}

// ---------------------------------------------------------------- 5. DNS / email authentication
console.log('\n[5] DNS and email deliverability');
if (isLocal) rec('SKIP', '5.x', 'local target');
else {
  const safe = async (f, ...a) => { try { return await f(...a); } catch { return []; } };
  const a4 = await safe(dns.resolve4, host), a6 = await safe(dns.resolve6, host), cn = await safe(dns.resolveCname, host);
  check('5.1', a4.length + a6.length + cn.length > 0, `${host} resolves (${[...a4, ...a6, ...cn].join(', ')})`, `${host} does not resolve`);
  const apex = host.replace(/^www\./, ''); const other = host.startsWith('www.') ? apex : `www.${apex}`;
  const o4 = [...await safe(dns.resolve4, other), ...await safe(dns.resolveCname, other)];
  check('5.2', o4.length > 0, `${other} also resolves (apex and www both work)`, `${other} does not resolve: half your visitors hit an error`, 'WARN');
  const caa = await safe(dns.resolveCaa, apex); check('5.3', caa.length > 0, `CAA present (${caa.map((c) => c.issue ?? c.issuewild).join(', ')})`, 'no CAA record: any CA may issue certificates for the domain', 'WARN');
  const sd = opt('sender-domain', apex); const txt = async (n) => (await safe(dns.resolveTxt, n)).map((r) => r.join(''));
  const spf = (await txt(sd)).find((t) => t.startsWith('v=spf1'));
  check('5.4', !!spf && /[-~]all\s*$/.test(spf), `SPF: ${spf}`, `SPF missing or ends in +all/?all (${spf ?? 'none'}). Alerts will land in spam`);
  const dm = (await txt(`_dmarc.${sd}`)).find((t) => t.startsWith('v=DMARC1'));
  check('5.5', !!dm && /p=(quarantine|reject)/.test(dm), `DMARC: ${dm}`, `DMARC missing or p=none (${dm ?? 'none'}): Gmail/Yahoo bulk-sender rules expect enforcement`, 'WARN');
  const dkim = (await txt(`resend._domainkey.${sd}`)).find((t) => /p=/.test(t)) || (await safe(dns.resolveCname, `resend._domainkey.${sd}`))[0];
  check('5.6', !!dkim, 'Resend DKIM record found (resend._domainkey)', `no DKIM at resend._domainkey.${sd}: verify the domain in Resend (or pass --sender-domain)`);
}

const f = results.filter((x) => x === 'FAIL').length, w = results.filter((x) => x === 'WARN').length;
console.log(`\n${results.filter((x) => x === 'PASS').length} passed, ${w} warnings, ${f} failed`);
process.exit(f ? 1 : 0);
