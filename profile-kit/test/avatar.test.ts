import sharp from 'sharp';
import { S } from './stubs';
import { POST, DELETE } from '../app/api/profile/avatar/route';
import { sniffImage, avatarPath, pathFromUrl, publicAvatarUrl, sameOriginOrBearer } from '../lib/profile/core';
let fails = 0; const ok = (c: unknown, m: string) => { if (!c) { fails++; console.log('FAIL:', m); } else console.log('ok -', m); };
process.env.SUPABASE_URL = 'https://abc.supabase.co';
const U = S.user.id;
const mkReq = (file: Buffer | null, o: { headers?: Record<string, string>; name?: string; type?: string; method?: string } = {}) => {
  const fd = new FormData(); if (file) fd.append('file', new File([new Uint8Array(file)], o.name ?? 'a.png', { type: o.type ?? 'image/png' }));
  const body = new Response(fd); // gives us a multipart body + boundary
  return body.arrayBuffer().then((ab) => new Request('https://bukmarkz.com/api/profile/avatar', { method: o.method ?? 'POST', body: ab, headers: { 'content-type': body.headers.get('content-type')!, 'content-length': String(ab.byteLength), 'sec-fetch-site': 'same-origin', ...o.headers } }));
};
const reset = () => { S.row = null; S.uploads.length = S.removed.length = S.upserts.length = S.creator.length = 0; S.failUpload = S.failSave = false; S.user = { id: U }; };

(async () => {
  const png = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#fca311' } }).png().toBuffer();
  const jpgExif = await sharp({ create: { width: 300, height: 500, channels: 3, background: '#10261c' } }).withExif({ IFD0: { Copyright: 'SECRET-OWNER' } }).jpeg().toBuffer();
  const webp = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#fff' } }).webp().toBuffer();
  ok(sniffImage(png) === 'png' && sniffImage(jpgExif) === 'jpeg' && sniffImage(webp) === 'webp', 'sniff: png/jpeg/webp');
  ok(!sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')) && !sniffImage(Buffer.from('GIF89a......')) && !sniffImage(Buffer.from('<?php echo 1; ?>....')), 'sniff: svg/gif/php rejected');
  ok(avatarPath(U, 'abcdef0123456789') === `${U}/abcdef0123456789.jpg` && avatarPath('../x', 'abcdef0123456789') === null && avatarPath(U, '../../etc/passwd') === null, 'avatarPath only builds safe paths');
  ok(pathFromUrl(`https://abc.supabase.co/storage/v1/object/public/avatars/${U}/abcdef0123456789.jpg`, U) === `${U}/abcdef0123456789.jpg` && pathFromUrl(`https://abc.supabase.co/storage/v1/object/public/avatars/22222222-2222-2222-2222-222222222222/abcdef0123456789.jpg`, U) === null && pathFromUrl(null, U) === null, "pathFromUrl refuses another user's file");
  ok(publicAvatarUrl('https://abc.supabase.co', 'x/y.jpg') === 'https://abc.supabase.co/storage/v1/object/public/avatars/x/y.jpg' && publicAvatarUrl('http://evil.example', 'x') === null, 'publicAvatarUrl pins https');
  ok(!sameOriginOrBearer(new Request('https://a.com/x', { method: 'POST', headers: { origin: 'https://evil.com' } })) && sameOriginOrBearer(new Request('https://a.com/x', { headers: { authorization: 'Bearer t' } })) && !sameOriginOrBearer(new Request('https://a.com/x', { headers: { 'sec-fetch-site': 'cross-site' } })), 'same-origin check');

  reset(); let r = await POST(await mkReq(png)); let j: any = await r.json();
  ok(r.status === 200 && /^https:\/\/abc\.supabase\.co\/storage\/v1\/object\/public\/avatars\/1{8}-1{4}-1{4}-1{4}-1{12}\/[0-9a-f]{16}\.jpg$/.test(j.url), 'POST png: 200 and a pinned public URL');
  ok(S.uploads.length === 1 && S.uploads[0].o.contentType === 'image/jpeg' && S.uploads[0].size < 30_000, 'stored one small JPEG');
  ok(S.upserts[0].avatar_url === j.url && S.creator[0].avatar_url === j.url, 'saved to user_profiles and creator_profiles');

  // capture the stored bytes to verify dimensions/metadata: re-run with a capturing stub
  reset(); let captured: Buffer | null = null; const orig = (await import('./stubs')).admin.storage.from; (await import('./stubs')).admin.storage.from = () => ({ upload: async (_p: string, b: Buffer) => { captured = b; return { error: null }; }, remove: async () => ({}) });
  r = await POST(await mkReq(jpgExif, { name: 'x.jpg', type: 'image/jpeg' }));
  const m = await sharp(captured!).metadata();
  ok(r.status === 200 && m.width === 256 && m.height === 256 && m.format === 'jpeg', 'output is 256x256 JPEG');
  ok(!m.exif && !captured!.includes(Buffer.from('SECRET-OWNER')), 'EXIF/metadata removed');
  (await import('./stubs')).admin.storage.from = orig;

  reset(); r = await POST(await mkReq(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), { name: 'a.png', type: 'image/png' })); ok(r.status === 415 && S.uploads.length === 0, 'svg disguised as .png: 415, nothing stored');
  reset(); r = await POST(await mkReq(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('garbagegarbagegarbage')]))); ok(r.status === 422 && S.uploads.length === 0, 'right header, broken body: 422');
  reset(); r = await POST(await mkReq(Buffer.alloc(2 * 1024 * 1024 + 10, 1))); ok(r.status === 413, 'over 2 MB: 413');
  reset(); r = await POST(await mkReq(png, { headers: { 'sec-fetch-site': 'cross-site' } })); ok(r.status === 403, 'cross-site POST: 403');
  reset(); S.user = null; r = await POST(await mkReq(png)); ok(r.status === 401, 'signed out: 401');
  reset(); r = await POST(new Request('https://bukmarkz.com/api/profile/avatar', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json', 'content-length': '2', 'sec-fetch-site': 'same-origin' } })); ok(r.status === 415, 'JSON body: 415');
  reset(); r = await POST(await mkReq(null)); ok(r.status === 400, 'no file: 400');
  reset(); S.row = { avatar_url: null, updated_at: new Date().toISOString() }; r = await POST(await mkReq(png)); ok(r.status === 429 && S.uploads.length === 0, 'second upload within 5 s: 429');
  reset(); S.failUpload = true; r = await POST(await mkReq(png)); ok(r.status === 502 && S.upserts.length === 0, 'storage failure: 502, nothing saved');
  reset(); S.failSave = true; r = await POST(await mkReq(png)); ok(r.status === 500 && S.removed.length === 1, 'save failure: uploaded file cleaned up');
  reset(); S.row = { avatar_url: `https://abc.supabase.co/storage/v1/object/public/avatars/${U}/0000000000000000.jpg`, updated_at: '2020-01-01T00:00:00Z' }; r = await POST(await mkReq(png));
  ok(r.status === 200 && S.removed.includes(`${U}/0000000000000000.jpg`), 'replacing deletes the previous file');
  reset(); S.row = { avatar_url: `https://abc.supabase.co/storage/v1/object/public/avatars/22222222-2222-2222-2222-222222222222/0000000000000000.jpg`, updated_at: '2020-01-01T00:00:00Z' }; r = await POST(await mkReq(png));
  ok(r.status === 200 && S.removed.length === 0, "never deletes a file outside the user's own folder");
  reset(); S.row = { avatar_url: `https://abc.supabase.co/storage/v1/object/public/avatars/${U}/0000000000000000.jpg` }; r = await DELETE(await mkReq(null, { method: 'DELETE' }).then((q) => new Request(q.url, { method: 'DELETE', headers: { 'sec-fetch-site': 'same-origin' } })));
  ok(r.status === 200 && S.removed.length === 1 && S.upserts[0].avatar_url === null && S.creator[0].avatar_url === null, 'DELETE clears file and addresses');
  console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
