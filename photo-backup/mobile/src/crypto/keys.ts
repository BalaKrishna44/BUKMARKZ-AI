/**
 * Key hierarchy (all derivation happens on the device; the server only stores the public salt/params):
 *
 *   user secret --Argon2id(salt)--> masterKey (32 B)
 *   masterKey  --HKDF("bkz/wrap")--> wrapKey  (AES-GCM, wraps per-file keys)
 *   masterKey  --HKDF("bkz/hash")--> hashKey  (HMAC-SHA256, dedup fingerprint)
 *   per file: random 256-bit DEK, wrapped by wrapKey, stored in user_photos.wrapped_key
 */
import { bytesToBase64, base64ToBytes, concat, utf8 } from './bytes';

import { subtle } from './subtle';

export type KdfParams =
  | { kdf: 'argon2id'; ops: number; memKiB: number }
  | { kdf: 'pbkdf2'; iter: number };

export const DEFAULT_ARGON2: KdfParams = { kdf: 'argon2id', ops: 3, memKiB: 64 * 1024 };
export const DEFAULT_PBKDF2: KdfParams = { kdf: 'pbkdf2', iter: 600_000 }; // OWASP 2023 for HMAC-SHA256

export interface UserKeys {
  wrapKey: CryptoKey;
  hashKey: CryptoKey;
  /** Raw master key, for Keychain/Keystore caching so background jobs can run while the phone is locked. */
  masterKeyRaw: Uint8Array;
}

/** Minimal surface of libsodium-wrappers / react-native-libsodium that we use. */
export interface SodiumLike {
  ready?: Promise<void>;
  crypto_pwhash(outLen: number, pw: string | Uint8Array, salt: Uint8Array, ops: number, memBytes: number, alg: number): Uint8Array;
  crypto_pwhash_ALG_ARGON2ID13: number;
}

export function newSalt(): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(16));
}

export async function deriveMasterKey(
  secret: string,
  salt: Uint8Array,
  params: KdfParams,
  sodium?: SodiumLike,
): Promise<Uint8Array> {
  const pw = utf8(secret.normalize('NFKC'));
  if (params.kdf === 'argon2id') {
    if (!sodium) throw new Error('libsodium instance required for Argon2id');
    await sodium.ready;
    return sodium.crypto_pwhash(32, pw, salt, params.ops, params.memKiB * 1024, sodium.crypto_pwhash_ALG_ARGON2ID13);
  }
  const base = await subtle.importKey('raw', pw, 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: params.iter }, base, 256);
  return new Uint8Array(bits);
}

async function hkdf(master: Uint8Array, info: string): Promise<Uint8Array> {
  const base = await subtle.importKey('raw', master, 'HKDF', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8(info) }, base, 256);
  return new Uint8Array(bits);
}

export async function keysFromMaster(master: Uint8Array): Promise<UserKeys> {
  const [w, h] = await Promise.all([hkdf(master, 'bkz/wrap'), hkdf(master, 'bkz/hash')]);
  return {
    masterKeyRaw: master,
    wrapKey: await subtle.importKey('raw', w, 'AES-GCM', false, ['encrypt', 'decrypt']),
    hashKey: await subtle.importKey('raw', h, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
  };
}

// ---- wrong-secret detection -------------------------------------------------------------------
const CHECK = utf8('bukmarkz-key-check');

export async function makeKeyCheck(keys: UserKeys): Promise<Uint8Array> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, keys.wrapKey, CHECK));
  return concat(iv, ct);
}

export async function verifyKeyCheck(keys: UserKeys, blob: Uint8Array): Promise<boolean> {
  try {
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: blob.slice(0, 12) }, keys.wrapKey, blob.slice(12));
    return bytesToBase64(new Uint8Array(pt)) === bytesToBase64(CHECK);
  } catch {
    return false;
  }
}

// ---- per-file data keys -----------------------------------------------------------------------
export function newDataKey(): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(32));
}

/** wrapped = iv(12) || AES-GCM(dek) (32 + 16 tag) = 60 bytes. `binding` (the file fingerprint) is AAD, so a wrapped key can't be swapped onto another file. */
export async function wrapDataKey(keys: UserKeys, dek: Uint8Array, binding: string): Promise<Uint8Array> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(binding) }, keys.wrapKey, dek));
  return concat(iv, ct);
}

export async function unwrapDataKey(keys: UserKeys, wrapped: Uint8Array, binding: string): Promise<Uint8Array> {
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: wrapped.slice(0, 12), additionalData: utf8(binding) }, keys.wrapKey, wrapped.slice(12));
  return new Uint8Array(pt);
}

export { base64ToBytes, bytesToBase64 };
