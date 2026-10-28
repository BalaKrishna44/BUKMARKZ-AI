/**
 * Chunked AES-256-GCM file encryption ("BKZE" v1).
 *
 * Why chunked: a 2 GB video cannot be held in JS memory, and one-shot GCM needs the whole buffer.
 * Each chunk is an independent GCM message, with three protections against reordering/truncation:
 *   - nonce_i  = baseIv with its last 4 bytes XOR big-endian(i)        -> unique per chunk, never reused
 *   - aad_i    = header(28 B) || finalFlag(1 B)                         -> binds chunk to this file + marks the last chunk
 *   - header carries the plaintext length                              -> truncation/extension detected
 * Because every file has its own random 256-bit key, nonce reuse across files is impossible.
 *
 * Layout:  header(28) || chunk_0 (plain_0 + 16 tag) || chunk_1 || ... || chunk_n-1 (final)
 * header = "BKZE" | version u8 | chunkSizeLog2 u8 | reserved u16 | baseIv 12 | plaintextLen u64 BE
 */
import { concat, toHex } from './bytes';
import type { UserKeys } from './keys';

import { subtle } from './subtle';

export const HEADER_LEN = 28;
export const TAG_LEN = 16;
export const DEFAULT_CHUNK_LOG2 = 22; // 4 MiB

/** The only platform-specific piece. RN implementation: src/sync/rnFileIO.ts */
export interface FileIO {
  size(path: string): Promise<number>;
  read(path: string, offset: number, length: number): Promise<Uint8Array>;
  /** Create/truncate when `offset === 0`, otherwise append. */
  write(path: string, data: Uint8Array, offset: number): Promise<void>;
}

export interface EncryptResult {
  baseIv: Uint8Array;
  plaintextLen: number;
  ciphertextLen: number;
  chunkSizeLog2: number;
  /** HMAC fingerprint for dedup / local-vs-remote comparison (hex). */
  fileHash: string;
}

export const ciphertextLength = (plain: number, log2: number) =>
  HEADER_LEN + plain + Math.max(1, Math.ceil(plain / 2 ** log2)) * TAG_LEN;

function buildHeader(baseIv: Uint8Array, plaintextLen: number, log2: number): Uint8Array {
  const h = new Uint8Array(HEADER_LEN);
  h.set([0x42, 0x4b, 0x5a, 0x45, 1, log2, 0, 0], 0); // "BKZE", v1
  h.set(baseIv, 8);
  new DataView(h.buffer).setBigUint64(20, BigInt(plaintextLen), false);
  return h;
}

function parseHeader(h: Uint8Array) {
  const magic = String.fromCharCode(h[0], h[1], h[2], h[3]);
  if (magic !== 'BKZE' || h[4] !== 1) throw new Error('not a BKZE v1 file');
  return {
    log2: h[5],
    baseIv: h.slice(8, 20),
    plaintextLen: Number(new DataView(h.buffer, h.byteOffset).getBigUint64(20, false)),
  };
}

function chunkNonce(baseIv: Uint8Array, i: number): Uint8Array {
  const n = baseIv.slice();
  const v = new DataView(n.buffer);
  v.setUint32(8, (v.getUint32(8, false) ^ i) >>> 0, false);
  return n;
}

const aad = (header: Uint8Array, isFinal: boolean) => concat(header, new Uint8Array([isFinal ? 1 : 0]));

// ---- fingerprint -----------------------------------------------------------------------------
// subtle has no streaming digest/HMAC, so: SHA-256 each chunk, then HMAC(hashKey, digests || length).
class Fingerprint {
  private digests: Uint8Array[] = [];
  constructor(private keys: UserKeys, private plaintextLen: number) {}
  async add(chunk: Uint8Array) { this.digests.push(new Uint8Array(await subtle.digest('SHA-256', chunk))); }
  async finish(): Promise<string> {
    const len = new Uint8Array(8);
    new DataView(len.buffer).setBigUint64(0, BigInt(this.plaintextLen), false);
    return toHex(new Uint8Array(await subtle.sign('HMAC', this.keys.hashKey, concat(...this.digests, len))));
  }
}

/** Hash a file without encrypting it (used by the cleanup engine to re-check local bytes). Fixed 4 MiB framing. */
export async function computeFileHash(io: FileIO, path: string, keys: UserKeys, log2 = DEFAULT_CHUNK_LOG2): Promise<string> {
  const size = await io.size(path);
  const fp = new Fingerprint(keys, size);
  const cs = 2 ** log2;
  for (let off = 0; off < size || off === 0; off += cs) {
    await fp.add(await io.read(path, off, Math.min(cs, size - off)));
    if (size === 0) break;
  }
  return fp.finish();
}

export async function encryptFile(
  io: FileIO,
  srcPath: string,
  dstPath: string,
  dek: Uint8Array,
  keys: UserKeys,
  log2 = DEFAULT_CHUNK_LOG2,
): Promise<EncryptResult> {
  const key = await subtle.importKey('raw', dek, 'AES-GCM', false, ['encrypt']);
  const plaintextLen = await io.size(srcPath);
  const baseIv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const header = buildHeader(baseIv, plaintextLen, log2);
  const cs = 2 ** log2;
  const chunks = Math.max(1, Math.ceil(plaintextLen / cs));
  const fp = new Fingerprint(keys, plaintextLen);

  await io.write(dstPath, header, 0);
  let outOff = HEADER_LEN;
  for (let i = 0; i < chunks; i++) {
    const plain = await io.read(srcPath, i * cs, Math.min(cs, plaintextLen - i * cs));
    await fp.add(plain);
    const ct = new Uint8Array(
      await subtle.encrypt(
        { name: 'AES-GCM', iv: chunkNonce(baseIv, i), additionalData: aad(header, i === chunks - 1), tagLength: 128 },
        key,
        plain,
      ),
    );
    await io.write(dstPath, ct, outOff);
    outOff += ct.length;
  }
  const ciphertextLen = await io.size(dstPath);
  if (ciphertextLen !== ciphertextLength(plaintextLen, log2)) throw new Error('ciphertext length mismatch');
  return { baseIv, plaintextLen, ciphertextLen, chunkSizeLog2: log2, fileHash: await fp.finish() };
}

/** Restore path. Throws if any byte was modified, reordered, or the file was truncated/extended. */
export async function decryptFile(io: FileIO, srcPath: string, dstPath: string, dek: Uint8Array): Promise<number> {
  const key = await subtle.importKey('raw', dek, 'AES-GCM', false, ['decrypt']);
  const header = await io.read(srcPath, 0, HEADER_LEN);
  const { log2, baseIv, plaintextLen } = parseHeader(header);
  const total = await io.size(srcPath);
  if (total !== ciphertextLength(plaintextLen, log2)) throw new Error('truncated or extended file');
  const cs = 2 ** log2;
  const chunks = Math.max(1, Math.ceil(plaintextLen / cs));
  let inOff = HEADER_LEN;
  let outOff = 0;
  for (let i = 0; i < chunks; i++) {
    const plainLen = Math.min(cs, plaintextLen - i * cs);
    const ct = await io.read(srcPath, inOff, plainLen + TAG_LEN);
    const pt = new Uint8Array(
      await subtle.decrypt(
        { name: 'AES-GCM', iv: chunkNonce(baseIv, i), additionalData: aad(header, i === chunks - 1), tagLength: 128 },
        key,
        ct,
      ),
    );
    await io.write(dstPath, pt, outOff);
    inOff += ct.length;
    outOff += pt.length;
  }
  return plaintextLen;
}
