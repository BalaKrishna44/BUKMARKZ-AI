/**
 * WebCrypto with byte-array parameters typed as plain Uint8Array. TypeScript >= 5.7 types SubtleCrypto
 * as taking Uint8Array<ArrayBuffer> only, which would force casts at every call; this keeps the
 * call sites readable and compiles on any TS version. Runtime is the platform's real SubtleCrypto
 * (Hermes/RN: install react-native-quick-crypto; Node/browsers: built in).
 */
interface Subtle {
  digest(alg: string, data: Uint8Array): Promise<ArrayBuffer>;
  sign(alg: string, key: CryptoKey, data: Uint8Array): Promise<ArrayBuffer>;
  importKey(fmt: 'raw', key: Uint8Array, alg: string | object, extractable: boolean, usages: string[]): Promise<CryptoKey>;
  encrypt(alg: object, key: CryptoKey, data: Uint8Array): Promise<ArrayBuffer>;
  decrypt(alg: object, key: CryptoKey, data: Uint8Array): Promise<ArrayBuffer>;
  deriveBits(alg: object, key: CryptoKey, bits: number): Promise<ArrayBuffer>;
}
export const subtle = globalThis.crypto.subtle as unknown as Subtle;
