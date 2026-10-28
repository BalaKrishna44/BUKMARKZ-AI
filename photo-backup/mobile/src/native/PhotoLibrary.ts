import { NativeEventEmitter, NativeModules } from 'react-native';

export interface ExportedAsset {
  path: string;          // temp file holding the ORIGINAL bytes (delete after upload)
  mediaType: 'image' | 'video';
  takenAtMs: number;
  modifiedAtMs: number;
  size: number;
}

/** Implemented twice: ios/PhotoLibraryModule.swift and android/PhotoLibraryModule.kt (same name/shape). */
interface PhotoLibraryNative {
  /** IDs queued by the OS-level observers since the last ack (iOS localIdentifier; Android "image:123" / "video:456"). */
  getPendingAssetIds(): Promise<string[]>;
  ackPendingAssetIds(ids: string[]): Promise<void>;
  /** Catch-up scan: enqueue assets created after max(sinceMs, native watermark). Pass 0 to use the watermark alone;
   on first run pass the user's chosen "back up photos since" date. */
  enqueueAssetsSince(sinceMs: number): Promise<number>;
  exportAsset(assetId: string): Promise<ExportedAsset>;
  /** Subset of `ids` that still exist in the library. */
  assetsExist(ids: string[]): Promise<string[]>;
  /**
   * Shows the OS deletion-consent dialog for the whole batch. Resolves with the ids that are actually gone.
   * Rejects with code USER_CANCELLED if the user declines.
   */
  deleteAssets(assetIds: string[]): Promise<{ deletedIds: string[] }>;
  /** iOS only: tell BGTaskScheduler the background run finished. */
  completeBackgroundTask(success: boolean): Promise<void>;
  startWatching(): Promise<void>;
}

export const PhotoLibrary = NativeModules.PhotoLibrary as PhotoLibraryNative;
export const photoLibraryEvents = new NativeEventEmitter(NativeModules.PhotoLibrary);
