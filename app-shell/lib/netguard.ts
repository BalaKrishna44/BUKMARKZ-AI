import net from 'node:net';

/** True for loopback, private, link-local, CGNAT, multicast, reserved and cloud-metadata addresses (v4, v6, v4-mapped v6). */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    const mapped = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    const hexMapped = l.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMapped) { const a = parseInt(hexMapped[1], 16), b = parseInt(hexMapped[2], 16); return isPrivateIp(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`); }
    if (l === '::' || l === '::1') return true;
    if (/^f[cd]/.test(l)) return true;                 // fc00::/7 unique local
    if (/^fe[89ab]/.test(l)) return true;              // fe80::/10 link-local
    if (/^ff/.test(l)) return true;                    // multicast
    if (/^(64:ff9b|2001:db8|2002:|100:)/.test(l)) return true; // NAT64, docs, 6to4, discard
    return false;
  }
  if (!net.isIPv4(ip)) return true;                    // unparseable => refuse
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||              // CGNAT
    (a === 169 && b === 254) ||                        // link-local incl. cloud metadata 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51) || (a === 203 && b === 0)
  );
}

export function parsePublicUrl(raw: string): URL {
  const u = new URL(raw);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('only http(s) URLs are allowed');
  if (u.username || u.password) throw new Error('credentials in URLs are not allowed');
  if (u.port && !['80', '443', '8080', '8443'].includes(u.port)) throw new Error('port not allowed');
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) throw new Error('internal hostname');
  if (net.isIP(h.replace(/^\[|\]$/g, '')) && isPrivateIp(h.replace(/^\[|\]$/g, ''))) throw new Error('private address');
  return u;
}

