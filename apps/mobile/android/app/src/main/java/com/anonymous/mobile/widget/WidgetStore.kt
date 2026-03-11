package com.anonymous.mobile.widget

import android.content.Context
import android.content.SharedPreferences

internal data class WidgetState(
  val title: String,
  val artist: String,
  val coverPath: String?,
  val isPlaying: Boolean,
  val lyric: String,
  val progress: Float,
  val colorPrimary: Int,
  val colorSecondary: Int
)

internal object WidgetStore {
  private const val PREFS_NAME = "audiodock_widget"
  private const val KEY_TITLE = "title"
  private const val KEY_ARTIST = "artist"
  private const val KEY_COVER = "cover_path"
  private const val KEY_PLAYING = "is_playing"
  private const val KEY_LYRIC = "lyric"
  private const val KEY_PROGRESS = "progress"
  private const val KEY_COLOR_PRIMARY = "color_primary"
  private const val KEY_COLOR_SECONDARY = "color_secondary"

  private fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  fun load(context: Context): WidgetState {
    val prefs = prefs(context)
    return WidgetState(
      title = prefs.getString(KEY_TITLE, "未在播放") ?: "未在播放",
      artist = prefs.getString(KEY_ARTIST, "") ?: "",
      coverPath = prefs.getString(KEY_COVER, null),
      isPlaying = prefs.getBoolean(KEY_PLAYING, false),
      lyric = prefs.getString(KEY_LYRIC, "") ?: "",
      progress = prefs.getFloat(KEY_PROGRESS, 0f),
      colorPrimary = prefs.getInt(KEY_COLOR_PRIMARY, 0xFF000000.toInt()),
      colorSecondary = prefs.getInt(KEY_COLOR_SECONDARY, 0xFF000000.toInt())
    )
  }

  fun save(
    context: Context,
    title: String,
    artist: String,
    coverPath: String?,
    isPlaying: Boolean,
    lyric: String,
    progress: Float,
    colorPrimary: Int,
    colorSecondary: Int
  ) {
    prefs(context).edit()
      .putString(KEY_TITLE, title)
      .putString(KEY_ARTIST, artist)
      .putString(KEY_COVER, coverPath)
      .putBoolean(KEY_PLAYING, isPlaying)
      .putString(KEY_LYRIC, lyric)
      .putFloat(KEY_PROGRESS, progress)
      .putInt(KEY_COLOR_PRIMARY, colorPrimary)
      .putInt(KEY_COLOR_SECONDARY, colorSecondary)
      .apply()
  }
}
