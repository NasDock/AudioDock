package com.anonymous.mobile.widget

import android.content.Context
import android.content.SharedPreferences

internal data class WidgetState(
  val title: String,
  val artist: String,
  val coverPath: String?,
  val isPlaying: Boolean
)

internal object WidgetStore {
  private const val PREFS_NAME = "audiodock_widget"
  private const val KEY_TITLE = "title"
  private const val KEY_ARTIST = "artist"
  private const val KEY_COVER = "cover_path"
  private const val KEY_PLAYING = "is_playing"

  private fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  fun load(context: Context): WidgetState {
    val prefs = prefs(context)
    return WidgetState(
      title = prefs.getString(KEY_TITLE, "未在播放") ?: "未在播放",
      artist = prefs.getString(KEY_ARTIST, "") ?: "",
      coverPath = prefs.getString(KEY_COVER, null),
      isPlaying = prefs.getBoolean(KEY_PLAYING, false)
    )
  }

  fun save(
    context: Context,
    title: String,
    artist: String,
    coverPath: String?,
    isPlaying: Boolean
  ) {
    prefs(context).edit()
      .putString(KEY_TITLE, title)
      .putString(KEY_ARTIST, artist)
      .putString(KEY_COVER, coverPath)
      .putBoolean(KEY_PLAYING, isPlaying)
      .apply()
  }
}
