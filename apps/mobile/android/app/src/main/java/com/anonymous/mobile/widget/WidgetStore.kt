package com.anonymous.mobile.widget

import android.content.Context
import android.content.SharedPreferences

internal data class WidgetState(
  val title: String,
  val artist: String,
  val coverPath: String?,
  val isPlaying: Boolean,
  val playMode: String,
  val isLiked: Boolean,
  val colorPrimary: Int,
  val colorSecondary: Int
)

internal object WidgetStore {
  private const val PREFS_NAME = "audiodock_widget"
  private const val KEY_TITLE = "title"
  private const val KEY_ARTIST = "artist"
  private const val KEY_COVER = "cover_path"
  private const val KEY_PLAYING = "is_playing"
  private const val KEY_PLAY_MODE = "play_mode"
  private const val KEY_IS_LIKED = "is_liked"
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
      playMode = prefs.getString(KEY_PLAY_MODE, "") ?: "",
      isLiked = prefs.getBoolean(KEY_IS_LIKED, false),
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
    playMode: String,
    isLiked: Boolean,
    colorPrimary: Int,
    colorSecondary: Int
  ) {
    prefs(context).edit()
      .putString(KEY_TITLE, title)
      .putString(KEY_ARTIST, artist)
      .putString(KEY_COVER, coverPath)
      .putBoolean(KEY_PLAYING, isPlaying)
      .putString(KEY_PLAY_MODE, playMode)
      .putBoolean(KEY_IS_LIKED, isLiked)
      .putInt(KEY_COLOR_PRIMARY, colorPrimary)
      .putInt(KEY_COLOR_SECONDARY, colorSecondary)
      .apply()
  }
}
