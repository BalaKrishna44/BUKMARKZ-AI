import { MMKV } from 'react-native-mmkv';

/** What this phone knows about its own backed-up assets. Contains no key material. */
export interface BackedUpEntry {
  assetId: string;
  photoId: string;
  fileHash: string;        // fingerprint recorded at upload time
  plaintextSize: number;
  modifiedAtMs: number;    // asset modification time when hashed; if unchanged we trust fileHash
  backedUpAtMs: number;
  deletedLocally?: boolean;
}

const kv = new MMKV({ id: 'bkz-index' });
const K = (id: string) => `a:${id}`;

export const localIndex = {
  put(e: BackedUpEntry) { kv.set(K(e.assetId), JSON.stringify(e)); },
  get(assetId: string): BackedUpEntry | undefined {
    const s = kv.getString(K(assetId));
    return s ? (JSON.parse(s) as BackedUpEntry) : undefined;
  },
  all(): BackedUpEntry[] {
    return kv.getAllKeys().filter((k) => k.startsWith('a:')).map((k) => JSON.parse(kv.getString(k)!) as BackedUpEntry);
  },
  markDeleted(assetIds: string[]) {
    for (const id of assetIds) { const e = this.get(id); if (e) this.put({ ...e, deletedLocally: true }); }
  },
};
