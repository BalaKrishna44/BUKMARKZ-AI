package com.bukmarkz.photosync

import android.content.Context
import androidx.work.*
import java.util.concurrent.TimeUnit

object SyncScheduler {
  private const val TRIGGER = "bkz-media-trigger"
  private const val NOW = "bkz-media-now"
  private const val PERIODIC = "bkz-media-periodic"

  private fun constraints(trigger: Boolean) = Constraints.Builder()
    .setRequiredNetworkType(NetworkType.CONNECTED)   // use UNMETERED for Wi-Fi only (JS also enforces wifiOnly)
    .setRequiresBatteryNotLow(true)
    .apply {
      if (trigger) {
        // JobScheduler wakes us when MediaStore changes, even if the process is dead.
        addContentUriTrigger(MediaScanner.IMAGES, true)
        addContentUriTrigger(MediaScanner.VIDEOS, true)
        setTriggerContentUpdateDelay(15, TimeUnit.SECONDS)  // batch bursts (camera burst, many screenshots)
        setTriggerContentMaxDelay(2, TimeUnit.MINUTES)
      }
    }.build()

  /** Call from Application.onCreate and after permissions are granted. Idempotent. */
  fun ensureScheduled(ctx: Context) {
    val wm = WorkManager.getInstance(ctx)
    wm.enqueueUniqueWork(TRIGGER, ExistingWorkPolicy.KEEP,
      OneTimeWorkRequestBuilder<MediaSyncWorker>().setConstraints(constraints(true)).build())
    // Safety net: some OEMs kill content triggers. Catch-up every 6 h.
    wm.enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP,
      PeriodicWorkRequestBuilder<MediaSyncWorker>(6, TimeUnit.HOURS).setConstraints(constraints(false)).build())
  }

  fun enqueueNow(ctx: Context) {
    WorkManager.getInstance(ctx).enqueueUniqueWork(NOW, ExistingWorkPolicy.KEEP,
      OneTimeWorkRequestBuilder<MediaSyncWorker>().setConstraints(constraints(false)).build())
  }

  /** A content-trigger one-shot is consumed when it runs, so the worker must re-arm it first thing. */
  fun rearmTrigger(ctx: Context) {
    WorkManager.getInstance(ctx).enqueueUniqueWork(TRIGGER, ExistingWorkPolicy.REPLACE,
      OneTimeWorkRequestBuilder<MediaSyncWorker>().setConstraints(constraints(true)).build())
  }
}
