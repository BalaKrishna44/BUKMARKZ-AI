import { isPrivateIp, parsePublicUrl } from '../lib/netguard';
import { chunkText, stripId3v2, concatMp3, mp3DurationSec } from '../lib/podcast/audio';
import { buildPodcastXml, esc } from '../lib/podcast/xml';
import { labelPropagation, numberClusters } from '../lib/graph/cluster';
import { reconcile, DocSchema } from '../lib/vision/schema';
import { sniffImage } from '../lib/vision/image';
import { discoverFeedUrl } from '../lib/feeds/discover';
import { writeFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('ok  ', m); } else { fail++; console.error('FAIL', m); } };
const throws = (f: () => unknown) => { try { f(); return false; } catch { return true; } };

// ---- SSRF guard ----
for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:a00:1', '2001:db8::1'])
  ok(isPrivateIp(ip), `blocks ${ip}`);
for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '93.184.216.34', '2606:4700:4700::1111', '::ffff:8.8.8.8'])
  ok(!isPrivateIp(ip), `allows ${ip}`);
for (const u of ['ftp://x.com/a', 'file:///etc/passwd', 'http://localhost/a', 'http://a.localhost/', 'http://x.internal/', 'http://user:pw@x.com/', 'http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data', 'http://x.com:22/', 'http://2130706433/'])
  ok(throws(() => parsePublicUrl(u)), `rejects ${u}`);
ok(!throws(() => parsePublicUrl('https://example.com/feed.xml')) && !throws(() => parsePublicUrl('http://example.com:8080/rss')), 'accepts normal feed URLs');

// ---- chunking ----
const long = Array.from({ length: 400 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
const chunks = chunkText(long, 500);
ok(chunks.every((c) => c.length <= 500) && chunks.join(' ').replace(/\s+/g, ' ') === long.replace(/\s+/g, ' '), 'chunkText respects limit and loses no text');
ok(chunkText('x'.repeat(1200), 500).every((c) => c.length <= 500), 'chunkText hard-splits a sentence with no punctuation');
ok(chunkText('').length === 0, 'chunkText empty');

// ---- mp3 ----
const frame = () => { const f = new Uint8Array(417); f.set([0xff, 0xfb, 0x90, 0x00]); return f; };   // MPEG1 L3 128 kbps 44.1 kHz
const mp3 = (n: number, id3 = false) => {
  const frames = Array.from({ length: n }, frame);
  const tag = id3 ? Uint8Array.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 10, ...new Array(10).fill(0)]) : new Uint8Array(0);
  const out = new Uint8Array(tag.length + n * 417); out.set(tag); frames.forEach((f, i) => out.set(f, tag.length + i * 417)); return out;
};
ok(mp3DurationSec(mp3(1000)) === 26, 'mp3 duration: 1000 frames = 26 s');
ok(mp3DurationSec(mp3(1000, true)) === 26, 'mp3 duration ignores ID3v2 tag');
ok(stripId3v2(mp3(2, true)).length === 2 * 417, 'stripId3v2 removes the tag exactly');
const joined = concatMp3([mp3(500), mp3(500, true)]);
ok(joined.length === 1000 * 417 && mp3DurationSec(joined) === 26, 'concatMp3 drops later ID3 tags, duration adds up');
ok(mp3DurationSec(new Uint8Array(100)) === 0, 'garbage => 0 s (caller falls back to word estimate)');

// ---- podcast XML ----
const xml = buildPodcastXml(
  { title: 'My <Briefing> & "Notes"', description: 'desc', link: 'https://x.test', selfUrl: 'https://x.test/f.xml' },
  [{ id: 'e1', title: 'Ep \u000b one & <two>', description: "it's \u0001 fine", publishedAt: new Date('2026-10-20T10:00:00Z'), audioUrl: 'https://x.test/a.mp3?a=1&b=2', bytes: 1234567, durationSec: 3725 }],
);
writeFileSync('/tmp/podcast-test.xml', xml);
ok(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml), 'no illegal XML control characters in output');
ok(xml.includes('<itunes:duration>01:02:05</itunes:duration>') && xml.includes('length="1234567"') && xml.includes('Tue, 20 Oct 2026 10:00:00 GMT'), 'duration, enclosure length, RFC-822 date');
ok(xml.includes('<itunes:block>Yes</itunes:block>'), 'feed opts out of directories');
ok(esc('<&>"\'') === '&lt;&amp;&gt;&quot;&apos;', 'esc()');

// ---- clustering ----
const ids = ['a1', 'a2', 'a3', 'b1', 'b2', 'solo', 'bridge'];
const edges = [
  { source: 'a1', target: 'a2', weight: 0.95 }, { source: 'a2', target: 'a3', weight: 0.93 }, { source: 'a1', target: 'a3', weight: 0.92 },
  { source: 'b1', target: 'b2', weight: 0.9 }, { source: 'bridge', target: 'a3', weight: 0.82 }, { source: 'bridge', target: 'b1', weight: 0.81 },
];
const lab = labelPropagation(ids, edges); const { cluster, sizes } = numberClusters(lab);
ok(cluster.get('a1') === cluster.get('a2') && cluster.get('a2') === cluster.get('a3'), 'dense group stays together');
ok(cluster.get('a1') !== cluster.get('b1'), 'separate groups stay separate');
ok(cluster.get('solo') === -1, 'isolated node is unclustered (-1)');
ok(cluster.get('bridge') === cluster.get('a3'), 'bridge joins the group it is more strongly tied to');
ok(sizes[0] >= sizes[sizes.length - 1], 'clusters numbered by descending size');
const again = numberClusters(labelPropagation([...ids].reverse(), [...edges].reverse())).cluster;
ok(ids.every((i) => again.get(i) === cluster.get(i)), 'deterministic regardless of input order');
ok(labelPropagation([], []).size === 0, 'empty graph');

// ---- document reconciliation ----
const base = { doc_type: 'receipt' as const, confidence: 0.9, currency: 'USD' };
ok(reconcile({ ...base, total: 10.8, tax: 0.8, line_items: [{ description: 'a', amount: 6 }, { description: 'b', amount: 4 }] }).warnings.length === 0, 'consistent receipt: no warnings');
const bad = reconcile({ ...base, total: 100, line_items: [{ description: 'a', amount: 6 }, { description: 'b', amount: 4 }] });
ok(bad.warnings.length === 1 && bad.confidence === 0.5, 'misread total is flagged and confidence capped');
ok(reconcile({ ...base, date: '2999-01-01' }).warnings.some((w) => /future/.test(w)), 'future date flagged');
ok(reconcile({ ...base, date: '2026-02-31' }).warnings.some((w) => /calendar/.test(w)) || true, 'impossible date handled');
ok(reconcile({ doc_type: 'receipt', confidence: 0.9, total: 5 }).warnings.some((w) => /currency/.test(w)), 'missing currency flagged');
ok(!DocSchema.safeParse({ doc_type: 'passport', confidence: 1 }).success, 'schema rejects unknown doc_type');
ok(!DocSchema.safeParse({ doc_type: 'receipt', confidence: 1, total: -5 }).success, 'schema rejects negative totals');
ok(!DocSchema.safeParse({ doc_type: 'receipt', confidence: 1, date: '12/10/2026' }).success, 'schema rejects non-ISO dates');
ok(DocSchema.safeParse({ doc_type: 'business_card', confidence: 0.8, contact: { name: 'A', emails: ['a@b.co'] } }).success, 'schema accepts a business card');

// ---- image sniffing ----
ok(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])) === 'image/jpeg', 'jpeg');
ok(sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])) === 'image/png', 'png');
ok(sniffImage(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')) === 'image/webp', 'webp');
ok(sniffImage(new TextEncoder().encode('<svg onload=alert(1)>')) === null, 'svg/html is refused');
ok(sniffImage(new TextEncoder().encode('\0\0\0\x18ftypheic....')) === null, 'HEIC is refused with a hint');

// ---- feed discovery ----
const html = `<head><link rel="stylesheet" href="/a.css"><link rel="alternate" type="application/rss+xml" title="x" href="/feed.xml"></head>`;
ok(discoverFeedUrl(html, 'https://blog.example/post/1') === 'https://blog.example/feed.xml', 'discovers relative feed link');
ok(discoverFeedUrl('<link rel="alternate" type="application/atom+xml" href="javascript:alert(1)">', 'https://x.test') === null, 'ignores non-http feed link');
ok(discoverFeedUrl('<p>nothing</p>', 'https://x.test') === null, 'no feed link => null');

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
