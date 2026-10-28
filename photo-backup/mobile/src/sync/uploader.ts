import RNFS from 'react-native-fs';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { bytesToBase64 } from '../crypto/bytes';
import { encryptFile, DEFAULT_CHUNK_LOG2 } from '../crypto/fileCipher';
import { newDataKey, wrapDataKey, type UserKeys } from '../crypto/keys';
import { PhotoLibrary } from '../native/PhotoLibrary';
import { api } from './api';
import { localIndex } from './localIndex';
import { rnFileIO } from './rnFileIO';

export type BackupOutcome = 'uploaded' | 'duplicate' | 'skipped';

/**
 * One asset, end to end:
 *   export original -> encrypt to temp file (never leaves the device in plaintext) -> presign ->
 *   stream PUT -> server verifies size -> record locally.
 * Idempotent: a crash anywhere leaves at most a 'pending' DB row that the next attempt overwrites.
 */
export async function backupAsset(assetId: string, keys: UserKeys): Promise<BackupOutcome> {
  if (localIndex.get(assetId)) return 'skipped';

  const exp = await PhotoLibrary.exportAsset(assetId);
  const encPath = `${RNFS.CachesDirectoryPath}/bkz-${Date.now()}-${Math.random().toString(36).slice(2)}.enc`;
  try {
    const dek = newDataKey();
    const enc = await encryptFile(rnFileIO, exp.path, encPath, dek, keys, DEFAULT_CHUNK_LOG2);

    // The wrap binds the DEK to the photo id, which the server assigns, so first ask for it with a
    // provisional binding = fileHash (stable, known client-side). Unwrapping uses the same value.
    const wrapped = await wrapDataKey(keys, dek, enc.fileHash);

    const res = await api.presign({
      fileHash: enc.fileHash,
      ciphertextSize: enc.ciphertextLen,
      plaintextSize: enc.plaintextLen,
      encryptionIv: bytesToBase64(enc.baseIv),
      wrappedKey: bytesToBase64(wrapped),
      chunkSizeLog2: enc.chunkSizeLog2,
      mediaType: exp.mediaType,
      takenAt: new Date(exp.takenAtMs).toISOString(),
    });

    if (res.duplicate) {
      localIndex.put({ assetId, photoId: res.photoId, fileHash: enc.fileHash, plaintextSize: enc.plaintextLen, modifiedAtMs: exp.modifiedAtMs, backedUpAtMs: Date.now() });
      return 'duplicate';
    }

    const put = await ReactNativeBlobUtil.fetch('PUT', res.uploadUrl, res.headers, ReactNativeBlobUtil.wrap(encPath));
    if (put.info().status < 200 || put.info().status >= 300) throw new Error(`R2 PUT failed: ${put.info().status}`);

    await api.complete(res.photoId); // server HEADs the object; only then does the row become 'verified'
    localIndex.put({ assetId, photoId: res.photoId, fileHash: enc.fileHash, plaintextSize: enc.plaintextLen, modifiedAtMs: exp.modifiedAtMs, backedUpAtMs: Date.now() });
    return 'uploaded';
  } finally {
    await RNFS.unlink(encPath).catch(() => {});
    await RNFS.unlink(exp.path).catch(() => {});
  }
}
