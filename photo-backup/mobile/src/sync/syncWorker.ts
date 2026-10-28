import NetInfo from '@react-native-community/netinfo';
import { loadKeys } from '../crypto/keyStore';
import { PhotoLibrary } from '../native/PhotoLibrary';
import { backupAsset } from './uploader';

export interface SyncOptions { wifiOnly?: boolean; deadlineMs?: number; signal?: { aborted: boolean } }

/** Drain the native pending queue. Safe to call from foreground, iOS BGProcessingTask or Android headless task. */
export async function runSyncOnce(opts: SyncOptions = {}): Promise<{ uploaded: number; failed: number; left: number }> {
  const keys = await loadKeys();
  if (!keys) return { uploaded: 0, failed: 0, left: -1 }; // user has not unlocked on this device yet

  const net = await NetInfo.fetch();
  if (!net.isConnected || (opts.wifiOnly && net.type !== 'wifi' && net.type !== 'ethernet')) return { uploaded: 0, failed: 0, left: -1 };

  const ids = await PhotoLibrary.getPendingAssetIds();
  const stop = Date.now() + (opts.deadlineMs ?? 25 * 60_000);
  let uploaded = 0, failed = 0;
  for (const id of ids) {
    if (opts.signal?.aborted || Date.now() > stop) break;
    try {
      await backupAsset(id, keys);
      await PhotoLibrary.ackPendingAssetIds([id]);
      uploaded++;
    } catch (e: any) {
      failed++;
      if (e?.status === 401) break;                 // signed out: stop, keep queue
      if (e?.code === 'E_ASSET_GONE') await PhotoLibrary.ackPendingAssetIds([id]); // deleted before we got to it
    }
  }
  return { uploaded, failed, left: ids.length - uploaded };
}
