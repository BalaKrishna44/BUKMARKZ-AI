package com.bukmarkz.photosync

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.provider.MediaStore

object MediaScanner {
  val IMAGES: Uri = MediaStore.Images.Media.EXTERNAL_CONTENT_URI
  val VIDEOS: Uri = MediaStore.Video.Media.EXTERNAL_CONTENT_URI

  fun uriFor(assetId: String): Uri? {
    val (kind, id) = assetId.split(":").let { if (it.size == 2) it[0] to it[1].toLongOrNull() else return null }
    id ?: return null
    return ContentUris.withAppendedId(if (kind == "video") VIDEOS else IMAGES, id)
  }

  /** Enqueue everything added after max(sinceSec, watermark). Returns the number of new ids. */
  fun enqueueSince(ctx: Context, sinceSec: Long): Int {
    val from = maxOf(sinceSec, PendingQueue.watermark(ctx))
    var newest = from
    val found = mutableListOf<String>()
    for ((uri, kind) in listOf(IMAGES to "image", VIDEOS to "video")) {
      ctx.contentResolver.query(
        uri, arrayOf(MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DATE_ADDED),
        "${MediaStore.MediaColumns.DATE_ADDED} > ? AND ${MediaStore.MediaColumns.IS_PENDING} = 0",
        arrayOf(from.toString()), null,
      )?.use { c ->
        while (c.moveToNext()) {
          found += "$kind:${c.getLong(0)}"
          newest = maxOf(newest, c.getLong(1))
        }
      }
    }
    if (found.isNotEmpty()) PendingQueue.add(ctx, found)
    PendingQueue.setWatermark(ctx, newest)
    return found.size
  }
}
