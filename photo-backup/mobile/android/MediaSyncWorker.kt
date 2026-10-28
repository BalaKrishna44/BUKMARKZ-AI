package com.bukmarkz.photosync

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

class MediaSyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
  override suspend fun doWork(): Result {
    SyncScheduler.rearmTrigger(applicationContext)           // 1. re-arm before anything can fail
    val added = MediaScanner.enqueueSince(applicationContext, 0) // 2. durable record of what is new
    if (added == 0 && PendingQueue.all(applicationContext).isEmpty()) return Result.success()
    return try {
      // 3. hand off to the JS pipeline (crypto + upload live in TypeScript) as a foreground service.
      ContextCompat.startForegroundService(applicationContext, Intent(applicationContext, SyncHeadlessService::class.java))
      Result.success()
    } catch (e: Exception) {
      Result.retry()    // e.g. ForegroundServiceStartNotAllowedException on Android 12+: queue is durable, retry later
    }
  }
}
