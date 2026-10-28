import { computeFileHash } from '../crypto/fileCipher';
import type { UserKeys } from '../crypto/keys';
import { PhotoLibrary } from '../native/PhotoLibrary';
import { api } from '../sync/api';
import { localIndex, type BackedUpEntry } from '../sync/localIndex';
import { rnFileIO } from '../sync/rnFileIO';
import RNFS from 'react-native-fs';

export interface Candidate extends BackedUpEntry {}
export interface ScanResult { candidates: Candidate[]; reclaimableBytes: number; skipped: { assetId: string; reason: string }[] }

const VERIFY_BATCH = 200; // server cap per request
const DELETE_BATCH = 100; // one OS consent dialog per batch

/**
 * Deletion is allowed ONLY when all of these hold for an asset:
 *   1. the server says the row is 'verified' AND the encrypted object currently exists in R2 with the right size
 *   2. the asset still exists locally
 *   3. the local bytes still hash to the fingerprint we uploaded (edited-since-upload photos are NOT deleted,
 *      because the backup would then hold an older version)
 */
export async function scanDeletable(keys: UserKeys, onProgress?: (done: number, total: number) => void): Promise<ScanResult> {
  const entries = localIndex.all().filter((e) => !e.deletedLocally);
  const skipped: ScanResult['skipped'] = [];
  const candidates: Candidate[] = [];

  const stillThere = new Set(await PhotoLibrary.assetsExist(entries.map((e) => e.assetId)));
  const present = entries.filter((e) => {
    if (!stillThere.has(e.assetId)) { localIndex.markDeleted([e.assetId]); return false; } // user already removed it
    return true;
  });

  let done = 0;
  for (let i = 0; i < present.length; i += VERIFY_BATCH) {
    const slice = present.slice(i, i + VERIFY_BATCH);
    const { verified } = await api.verify(slice.map((e) => e.fileHash));
    const ok = new Set(verified.map((v) => v.fileHash));

    for (const e of slice) {
      done++;
      onProgress?.(done, present.length);
      if (!ok.has(e.fileHash)) { skipped.push({ assetId: e.assetId, reason: 'not verified on server' }); continue; }
      try {
        const exp = await PhotoLibrary.exportAsset(e.assetId); // fresh copy of the current bytes
        try {
          // Cheap path: unchanged modification time means the recorded hash is still valid, but we have
          // the file anyway, so re-hash it: this is the actual "local checksum matches" proof.
          const local = await computeFileHash(rnFileIO, exp.path, keys);
          if (local !== e.fileHash) { skipped.push({ assetId: e.assetId, reason: 'changed since backup' }); continue; }
        } finally { await RNFS.unlink(exp.path).catch(() => {}); }
        candidates.push(e);
      } catch (err: any) {
        skipped.push({ assetId: e.assetId, reason: err?.code ?? 'unreadable' });
      }
    }
  }
  return { candidates, reclaimableBytes: candidates.reduce((n, c) => n + c.plaintextSize, 0), skipped };
}

export interface FreeUpResult { deleted: number; cancelled: boolean }

/** Runs the batched OS consent flow. Stops cleanly if the user declines a batch. */
export async function freeUpSpace(candidates: Candidate[], onProgress?: (deleted: number, total: number) => void): Promise<FreeUpResult> {
  let deleted = 0;
  for (let i = 0; i < candidates.length; i += DELETE_BATCH) {
    const batch = candidates.slice(i, i + DELETE_BATCH);
    try {
      const { deletedIds } = await PhotoLibrary.deleteAssets(batch.map((c) => c.assetId));
      localIndex.markDeleted(deletedIds);
      deleted += deletedIds.length;
      onProgress?.(deleted, candidates.length);
    } catch (e: any) {
      if (e?.code === 'USER_CANCELLED') return { deleted, cancelled: true };
      throw e;
    }
  }
  return { deleted, cancelled: false };
}
