import { AppRegistry, Platform } from 'react-native';
import { PhotoLibrary, photoLibraryEvents } from '../native/PhotoLibrary';
import { runSyncOnce } from './syncWorker';

/** Call once from index.js, outside any component. */
export function registerBackgroundSync() {
  // Android: WorkManager worker starts SyncHeadlessService, which runs this task.
  AppRegistry.registerHeadlessTask('BukmarkzPhotoSync', () => async () => {
    await runSyncOnce({ wifiOnly: true, deadlineMs: 9 * 60_000 });
  });

  // iOS: BGTaskScheduler fires natively, which emits this event into the (background-launched) JS runtime.
  if (Platform.OS === 'ios') {
    const abort = { aborted: false };
    photoLibraryEvents.addListener('BackgroundSyncStarted', async () => {
      abort.aborted = false;
      let ok = false;
      try { await PhotoLibrary.enqueueAssetsSince(0); const r = await runSyncOnce({ wifiOnly: true, signal: abort }); ok = r.failed === 0; }
      finally { await PhotoLibrary.completeBackgroundTask(ok); }
    });
    photoLibraryEvents.addListener('BackgroundSyncExpiring', () => { abort.aborted = true; });
  }
}
