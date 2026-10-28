package com.bukmarkz.photosync

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/** Runs the JS task 'BukmarkzPhotoSync' (see src/sync/background.ts) with a visible, low-priority notification. */
class SyncHeadlessService : HeadlessJsTaskService() {
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val nm = getSystemService(NotificationManager::class.java)
    nm.createNotificationChannel(NotificationChannel("bkz_sync", "Backup", NotificationManager.IMPORTANCE_LOW))
    val n: Notification = NotificationCompat.Builder(this, "bkz_sync")
      .setContentTitle("Backing up photos").setSmallIcon(android.R.drawable.stat_sys_upload).setOngoing(true).build()
    if (Build.VERSION.SDK_INT >= 29) startForeground(42, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    else startForeground(42, n)
    return super.onStartCommand(intent, flags, startId)
  }

  override fun getTaskConfig(intent: Intent?) =
    HeadlessJsTaskConfig("BukmarkzPhotoSync", Arguments.createMap(), 10 * 60_000, true)
}
