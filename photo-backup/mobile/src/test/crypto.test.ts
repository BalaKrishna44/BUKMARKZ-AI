import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { encryptFile, decryptFile, computeFileHash, ciphertextLength, HEADER_LEN, TAG_LEN, type FileIO } from '../crypto/fileCipher';
import { deriveMasterKey, keysFromMaster, newDataKey, wrapDataKey, unwrapDataKey, makeKeyCheck, verifyKeyCheck, newSalt, type KdfParams } from '../crypto/keys';
import { bytesToBase64, base64ToBytes } from '../crypto/bytes';

const io: FileIO = {
  async size(p) { return fs.statSync(p).size; },
  async read(p, off, len) { const fd = fs.openSync(p, 'r'); const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, off); fs.closeSync(fd); return new Uint8Array(b); },
  async write(p, d, off) { if (off === 0) fs.writeFileSync(p, d); else { const fd = fs.openSync(p, 'r+'); fs.writeSync(fd, d, 0, d.length, off); fs.closeSync(fd); } },
};
let pass = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else { pass++; console.log('ok  ', m); } };
const throws = async (f: () => Promise<unknown>, m: string) => { try { await f(); ok(false, m); } catch { ok(true, m); } };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bkz-'));
  const P = (n: string) => path.join(dir, n);
  const params: KdfParams = { kdf: 'pbkdf2', iter: 1000 }; // low only for test speed
  const salt = newSalt();
  const keys = await keysFromMaster(await deriveMasterKey('correct horse battery', salt, params));
  const other = await keysFromMaster(await deriveMasterKey('wrong secret', salt, params));
  const LOG2 = 16; // 64 KiB chunks so small files span several chunks

  for (const size of [0, 1, 65535, 65536, 65537, 200_000, 3 * 65536]) {
    const src = P(`s${size}`);     const buf = Buffer.alloc(size); for (let i = 0; i < size; i += 65536) globalThis.crypto.getRandomValues(buf.subarray(i, Math.min(size, i + 65536)));
    fs.writeFileSync(src, buf);
    const dek = newDataKey();
    const r = await encryptFile(io, src, P(`e${size}`), dek, keys, LOG2);
    ok(fs.statSync(P(`e${size}`)).size === ciphertextLength(size, LOG2), `size ${size}: ciphertext length formula`);
    ok(r.fileHash === await computeFileHash(io, src, keys, LOG2), `size ${size}: encrypt-time hash == standalone hash`);
    await decryptFile(io, P(`e${size}`), P(`d${size}`), dek);
    ok(Buffer.compare(fs.readFileSync(P(`d${size}`)), buf) === 0, `size ${size}: round trip`);
    if (size > 0) ok(!fs.readFileSync(P(`e${size}`)).includes(buf.subarray(0, Math.min(32, size))), `size ${size}: plaintext not visible in blob`);
  }

  // adversarial, on the 200_000 byte file (4 chunks)
  const e = fs.readFileSync(P('e200000'));
  const dek2 = newDataKey();
  const src = P('s200000');
  await encryptFile(io, src, P('x'), dek2, keys, LOG2);
  const x = fs.readFileSync(P('x'));
  const tamper = (mut: (b: Buffer) => Buffer, name: string) => throws(async () => { fs.writeFileSync(P('t'), mut(Buffer.from(x))); await decryptFile(io, P('t'), P('o'), dek2); }, name);
  await tamper((b) => { b[HEADER_LEN + 10] ^= 1; return b; }, 'flipped ciphertext bit rejected');
  await tamper((b) => { b[8] ^= 1; return b; }, 'modified header (iv) rejected');
  await tamper((b) => { b[27] ^= 1; return b; }, 'modified header (length) rejected');
  await tamper((b) => b.subarray(0, b.length - (65536 + TAG_LEN)), 'dropped final chunk rejected');
  await tamper((b) => Buffer.concat([b, Buffer.alloc(5)]), 'appended bytes rejected');
  await tamper((b) => { const c = 65536 + TAG_LEN; const a = Buffer.from(b.subarray(HEADER_LEN, HEADER_LEN + c)); b.copy(b, HEADER_LEN, HEADER_LEN + c, HEADER_LEN + 2 * c); a.copy(b, HEADER_LEN + c); return b; }, 'swapped chunks rejected');
  await throws(() => decryptFile(io, P('x'), P('o'), newDataKey()), 'wrong file key rejected');
  ok(e.length > 0, 'sanity');

  // two encryptions of same file differ (fresh key+iv) but fingerprint is identical (dedup)
  const a = await encryptFile(io, src, P('a1'), newDataKey(), keys, LOG2);
  const b = await encryptFile(io, src, P('a2'), newDataKey(), keys, LOG2);
  ok(a.fileHash === b.fileHash && Buffer.compare(fs.readFileSync(P('a1')), fs.readFileSync(P('a2'))) !== 0, 'same fingerprint, different ciphertext');
  ok(a.fileHash !== await computeFileHash(io, src, other, LOG2), 'fingerprint depends on user secret (not a bare file SHA-256)');

  // key wrapping
  const dek = newDataKey();
  const w = await wrapDataKey(keys, dek, 'fp-1');
  ok(w.length === 60, 'wrapped key is 60 bytes (matches SQL check)');
  ok(Buffer.compare(await unwrapDataKey(keys, w, 'fp-1'), dek) === 0, 'unwrap ok');
  await throws(() => unwrapDataKey(keys, w, 'fp-2'), 'unwrap bound to fingerprint');
  await throws(() => unwrapDataKey(other, w, 'fp-1'), 'unwrap with wrong secret fails');
  const kc = await makeKeyCheck(keys);
  ok(await verifyKeyCheck(keys, kc) && !(await verifyKeyCheck(other, kc)), 'key-check detects wrong secret');

  // base64 helpers vs Buffer
  for (const n of [0, 1, 2, 3, 12, 60, 61]) { const r = globalThis.crypto.getRandomValues(new Uint8Array(n)); ok(bytesToBase64(r) === Buffer.from(r).toString('base64') && Buffer.compare(base64ToBytes(bytesToBase64(r)), r) === 0, `base64 len ${n}`); }
  console.log(`\n${pass} checks passed`);
})();
