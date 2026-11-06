import dns from 'node:dns';
import { isPrivateIp, parsePublicUrl } from './netguard';
import { Agent } from 'undici';

// The check happens inside the socket's DNS lookup, so the address we validate is the address we connect to
// (no resolve-then-connect window for DNS rebinding).
const agent = new Agent({
  connect: {
    lookup(host, opts, cb) {
      dns.lookup(host, { ...opts, all: true }, (err, addrs) => {
        if (err) return (cb as any)(err);
        const list = addrs as dns.LookupAddress[];
        const bad = list.find((a) => isPrivateIp(a.address));
        if (bad || list.length === 0) return (cb as any)(new Error(`blocked address for ${host}`));
        if ((opts as any).all) return (cb as any)(null, list);
        (cb as any)(null, list[0].address, list[0].family);
      });
    },
  },
});

export interface SafeResponse { status: number; headers: Headers; body: Uint8Array; url: string }

/** fetch for user-supplied URLs: SSRF-safe, bounded size, bounded time, manual redirects re-validated per hop. */
export async function safeFetch(
  rawUrl: string,
  opts: { maxBytes?: number; timeoutMs?: number; headers?: Record<string, string>; maxRedirects?: number } = {},
): Promise<SafeResponse> {
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  let url = parsePublicUrl(rawUrl);
  for (let hop = 0; hop <= (opts.maxRedirects ?? 3); hop++) {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      headers: { 'user-agent': 'BukmarkzFeedBot/1.0 (+https://www.bukmarkz.com)', ...opts.headers },
      // @ts-expect-error undici dispatcher is accepted by Node's fetch
      dispatcher: agent,
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = parsePublicUrl(new URL(res.headers.get('location')!, url).toString());
      continue;
    }
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > maxBytes) throw new Error('response too large');
    const chunks: Uint8Array[] = []; let total = 0;
    if (res.body) {
      for await (const c of res.body as any as AsyncIterable<Uint8Array>) {
        total += c.length;
        if (total > maxBytes) throw new Error('response too large');
        chunks.push(c);
      }
    }
    const body = new Uint8Array(total); let o = 0;
    for (const c of chunks) { body.set(c, o); o += c.length; }
    return { status: res.status, headers: res.headers, body, url: url.toString() };
  }
  throw new Error('too many redirects');
}
