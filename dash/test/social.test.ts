import { parseStack, safeAvatar } from '../lib/stacks/public';
import { avatarDataUri, clip, titleSize } from '../lib/stacks/og';
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('ok  ', m); } else { fail++; console.error('FAIL', m); } };
const SB = 'https://abc.supabase.co';
const AV = `${SB}/storage/v1/object/public/avatars/u1/me.png`;

// avatar URLs are user-controlled: only our own public avatars bucket is accepted
ok(safeAvatar(AV, SB) === AV, 'own Storage avatar accepted');
ok(safeAvatar('https://evil.com/storage/v1/object/public/avatars/a.png', SB) === null, 'other host rejected');
ok(safeAvatar(`${SB}/storage/v1/object/public/private-bucket/a.png`, SB) === null, 'other bucket rejected');
ok(safeAvatar(`${SB}/storage/v1/object/public/avatars/../secrets/a.png`, SB) === null || !safeAvatar(`${SB}/storage/v1/object/public/avatars/../secrets/a.png`, SB)!.includes('..'), 'path traversal is normalised away or rejected');
ok(safeAvatar('http://abc.supabase.co/storage/v1/object/public/avatars/a.png', SB) === null, 'http rejected');
ok(safeAvatar('https://user:pw@abc.supabase.co/storage/v1/object/public/avatars/a.png', SB) === null, 'credentials in URL rejected');
ok(safeAvatar('https://abc.supabase.co.evil.com/storage/v1/object/public/avatars/a.png', SB) === null, 'look-alike host rejected');
ok(safeAvatar('javascript:alert(1)', SB) === null && safeAvatar(null, SB) === null && safeAvatar(42, SB) === null && safeAvatar(AV, undefined) === null, 'junk / no config -> null');

// parseStack: new fields are validated, never trusted
process.env.NEXT_PUBLIC_SUPABASE_URL = SB;
const base = { slug: 'rusty-copy', title: 'Rusty', handle: 'bob_builds', theme: 'ocean', items: [{ title: 'a', url: 'https://a.com' }] };
const s = parseStack({ ...base, avatar_url: AV, follower_count: 12, remix_count: 3, remixed_from: { slug: 'best-rust-reads', title: 'Best Rust Reads', handle: 'ada_codes' } })!;
ok(s.avatar === AV && s.follower_count === 12 && s.remix_count === 3 && s.remixed_from?.handle === 'ada_codes', 'valid social fields parsed');
const bad = parseStack({ ...base, avatar_url: 'https://evil.com/x.png', follower_count: -5, remix_count: 'many', remixed_from: { slug: '../etc', handle: '<b>x</b>', title: 'T' } })!;
ok(bad.avatar === null && bad.follower_count === 0 && bad.remix_count === 0 && bad.remixed_from === null, 'bad avatar, counts and credit are neutralised');
ok(parseStack(base)!.remixed_from === null && parseStack({ ...base, remixed_from: null })!.remixed_from === null, 'no credit when absent/null');

// OG avatar inlining: any problem -> null (the card then shows the initial instead of failing)
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const resp = (body: Uint8Array | string, type: string, status = 200, extra: Record<string, string> = {}) => async () => new Response(body as any, { status, headers: { 'content-type': type, ...extra } });
const run = async () => {
  const d = await avatarDataUri(AV, resp(png, 'image/png') as any);
  ok(!!d && d.startsWith('data:image/png;base64,iVBORw0KGgo'), 'png inlined as data URI');
  ok(await avatarDataUri(null) === null, 'null url -> null');
  ok(await avatarDataUri(AV, resp('<svg/>', 'image/svg+xml') as any) === null, 'svg rejected (script/xml risk)');
  ok(await avatarDataUri(AV, resp(png, 'image/webp') as any) === null, 'webp rejected (Satori cannot decode)');
  ok(await avatarDataUri(AV, resp(png, 'image/png', 404) as any) === null, '404 -> null');
  ok(await avatarDataUri(AV, resp(png, 'image/png', 200, { 'content-length': '999999' }) as any) === null, 'declared oversize -> null');
  ok(await avatarDataUri(AV, resp(new Uint8Array(400_000), 'image/png') as any) === null, 'actual oversize -> null');
  ok(await avatarDataUri(AV, (async () => { throw new Error('boom'); }) as any) === null, 'network error -> null');
  ok(await avatarDataUri(AV, ((_u: any, init: any) => new Promise((_r, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))))) as any, 30) === null, 'slow avatar times out -> null');
  ok(clip('abcdef', 4) === 'abc…' && titleSize(10) === 88 && titleSize(80) === 48, 'clip / title tiers unchanged');
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
};
run();
