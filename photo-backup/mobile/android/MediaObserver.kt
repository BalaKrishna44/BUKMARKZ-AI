package com.bukmarkz.photosync

import android.content.Context
import android.database.ContentObserver
import android.net.Uri
import android.os.Handler
import android.os.Looper

/**
 * In-process observer: fires immediately while the app process is alive (foreground or recently backgrounded).
 * It only *enqueues work*; the heavy lifting runs in WorkManager. When the process is dead the
 * ContentUriTrigger constraint in SyncScheduler takes over.
 */
class MediaObserver(private val ctx: Context) : ContentObserver(Handler(Looper.getMainLooper())) {
  override fun onChange(selfChange: Boolean, uri: Uri?) {
    SyncScheduler.enqueueNow(ctx)
  }

  fun register() {
    ctx.contentResolver.registerContentObserver(MediaScanner.IMAGES, true, this)
    ctx.contentResolver.registerContentObserver(MediaScanner.VIDEOS, true, this)
  }
  fun unregister() = ctx.contentResolver.unregisterContentObserver(this)
}
