package com.bukmarkz.photosync

import android.content.Context

/** Persisted set of asset ids ("image:123" / "video:456") awaiting backup, plus the MediaStore watermark. */
object PendingQueue {
  private fun p(c: Context) = c.getSharedPreferences("bkz_queue", Context.MODE_PRIVATE)
  @Synchronized fun add(c: Context, ids: Collection<String>) {
    val cur = p(c).getStringSet("ids", emptySet())!!.toMutableSet(); cur.addAll(ids)
    p(c).edit().putStringSet("ids", cur).apply()
  }
  @Synchronized fun all(c: Context): List<String> = p(c).getStringSet("ids", emptySet())!!.toList()
  @Synchronized fun remove(c: Context, ids: Collection<String>) {
    val cur = p(c).getStringSet("ids", emptySet())!!.toMutableSet(); cur.removeAll(ids.toSet())
    p(c).edit().putStringSet("ids", cur).apply()
  }
  // DATE_ADDED (seconds) of the newest asset already enqueued.
  fun watermark(c: Context): Long = p(c).getLong("wm", 0L)
  fun setWatermark(c: Context, v: Long) = p(c).edit().putLong("wm", v).apply()
}
