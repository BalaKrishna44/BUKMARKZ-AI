package com.bukmarkz.photosync

import android.app.Activity
import android.content.ContentUris
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import com.facebook.react.bridge.*
import java.io.File

class PhotoLibraryModule(private val rc: ReactApplicationContext) : ReactContextBaseJavaModule(rc), ActivityEventListener {
  private var observer: MediaObserver? = null
  private var pendingDelete: Pair<Promise, List<String>>? = null
  private val REQ_DELETE = 7421

  init { rc.addActivityEventListener(this) }
  override fun getName() = "PhotoLibrary"
  @ReactMethod fun addListener(name: String) {}
  @ReactMethod fun removeListeners(count: Int) {}

  @ReactMethod fun startWatching(p: Promise) {
    if (observer == null) { observer = MediaObserver(rc.applicationContext).also { it.register() } }
    SyncScheduler.ensureScheduled(rc.applicationContext)
    p.resolve(null)
  }
  @ReactMethod fun getPendingAssetIds(p: Promise) = p.resolve(Arguments.fromList(PendingQueue.all(rc)))
  @ReactMethod fun ackPendingAssetIds(ids: ReadableArray, p: Promise) { PendingQueue.remove(rc, ids.toArrayList().map { it as String }); p.resolve(null) }
  @ReactMethod fun completeBackgroundTask(ok: Boolean, p: Promise) = p.resolve(null) // iOS-only concept
  @ReactMethod fun enqueueAssetsSince(sinceMs: Double, p: Promise) = p.resolve(MediaScanner.enqueueSince(rc, (sinceMs / 1000).toLong()))

  @ReactMethod fun assetsExist(ids: ReadableArray, p: Promise) {
    p.resolve(Arguments.fromList(existing(ids.toArrayList().map { it as String })))
  }

  private fun existing(ids: List<String>): List<String> = ids.filter { id ->
    val uri = MediaScanner.uriFor(id) ?: return@filter false
    rc.contentResolver.query(uri, arrayOf(MediaStore.MediaColumns._ID), null, null, null)?.use { it.moveToFirst() } == true
  }

  @ReactMethod fun exportAsset(id: String, p: Promise) {
    Thread {
      try {
        val uri = MediaScanner.uriFor(id) ?: return@Thread p.reject("E_ASSET_GONE", "bad id")
        var taken = 0L; var modified = 0L
        val found = rc.contentResolver.query(uri, arrayOf(MediaStore.MediaColumns.DATE_TAKEN, MediaStore.MediaColumns.DATE_MODIFIED, MediaStore.MediaColumns.DATE_ADDED), null, null, null)?.use { c ->
          if (!c.moveToFirst()) false else { taken = c.getLong(0).takeIf { it > 0 } ?: (c.getLong(2) * 1000); modified = c.getLong(1) * 1000; true }
        } ?: false
        if (!found) return@Thread p.reject("E_ASSET_GONE", "asset no longer exists")
        val out = File(rc.cacheDir, "bkz-${System.nanoTime()}")
        rc.contentResolver.openInputStream(uri)!!.use { i -> out.outputStream().use { o -> i.copyTo(o, 1 shl 20) } }
        p.resolve(Arguments.createMap().apply {
          putString("path", out.absolutePath); putString("mediaType", if (id.startsWith("video")) "video" else "image")
          putDouble("takenAtMs", taken.toDouble()); putDouble("modifiedAtMs", modified.toDouble()); putDouble("size", out.length().toDouble())
        })
      } catch (e: Exception) { p.reject("E_EXPORT", e.message, e) }
    }.start()
  }

  /**
   * API 30+: MediaStore.createDeleteRequest shows ONE system dialog for the whole batch
   * ("Allow Bukmarkz to delete N photos?"). The delete is permanent (createTrashRequest would use the trash).
   * API < 30 has no batch consent API: reject so the JS layer can fall back to per-item flow.
   */
  @ReactMethod fun deleteAssets(ids: ReadableArray, p: Promise) {
    val list = ids.toArrayList().map { it as String }
    val act = currentActivity ?: return p.reject("E_NO_ACTIVITY", "App must be in the foreground")
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return p.reject("E_UNSUPPORTED_OS", "Batch delete needs Android 11+")
    if (pendingDelete != null) return p.reject("E_BUSY", "A delete request is already open")
    val uris: List<Uri> = list.mapNotNull { MediaScanner.uriFor(it) }
    if (uris.isEmpty()) return p.resolve(Arguments.createMap().apply { putArray("deletedIds", Arguments.fromList(list)) })
    try {
      val sender = MediaStore.createDeleteRequest(rc.contentResolver, uris).intentSender
      pendingDelete = p to list
      act.startIntentSenderForResult(sender, REQ_DELETE, null, 0, 0, 0)
    } catch (e: Exception) { pendingDelete = null; p.reject("E_DELETE", e.message, e) }
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != REQ_DELETE) return
    val (promise, ids) = pendingDelete ?: return
    pendingDelete = null
    if (resultCode == Activity.RESULT_OK) {
      val gone = ids - existing(ids).toSet()      // trust the library, not the result code
      promise.resolve(Arguments.createMap().apply { putArray("deletedIds", Arguments.fromList(gone)) })
    } else promise.reject("USER_CANCELLED", "User declined deletion")
  }
  override fun onNewIntent(intent: Intent) {}
}
