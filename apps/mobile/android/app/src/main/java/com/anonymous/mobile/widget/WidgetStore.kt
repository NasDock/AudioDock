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
  val colorSecondary: Int,
  val position: Int,
  val duration: Int,
  val playlistsJson: String,
  val historyJson: String,
  val latestJson: String,
  val recommendationsJson: String
)

internal object WidgetStore {
  private const val PREFS_NAME = "audiodock_widget"
  private const val KEY_TITLE = "title"
  private const val KEY_ARTIST = "artist"
  private const val KEY_COVER = "cover_path"
  private const val KEY_PLAYING = "is_playing"
  private const val KEY_PLAY_MODE = "play_mode"
  private const val KEY_PLAY_MODE_OVERRIDE = "play_mode_override"
  private const val KEY_PLAY_MODE_OVERRIDE_UNTIL = "play_mode_override_until"
  private const val KEY_IS_LIKED = "is_liked"
  private const val KEY_IS_LIKED_OVERRIDE = "is_liked_override"
  private const val KEY_IS_LIKED_OVERRIDE_UNTIL = "is_liked_override_until"
  private const val KEY_COLOR_PRIMARY = "color_primary"
  private const val KEY_COLOR_SECONDARY = "color_secondary"
  private const val KEY_POSITION = "position"
  private const val KEY_DURATION = "duration"
  private const val KEY_PLAYLISTS = "playlists_json"
  private const val KEY_HISTORY = "history_json"
  private const val KEY_LATEST = "latest_json"
  private const val KEY_RECOMMENDATIONS = "recommendations_json"

  private fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  fun load(context: Context): WidgetState {
    val prefs = prefs(context)
    val resolvedPlayMode = resolvePlayMode(prefs)
    val resolvedLiked = resolveLiked(prefs)
    return WidgetState(
      title = prefs.getString(KEY_TITLE, "未在播放") ?: "未在播放",
      artist = prefs.getString(KEY_ARTIST, "") ?: "",
      coverPath = prefs.getString(KEY_COVER, null),
      isPlaying = prefs.getBoolean(KEY_PLAYING, false),
      playMode = resolvedPlayMode,
      isLiked = resolvedLiked,
      colorPrimary = prefs.getInt(KEY_COLOR_PRIMARY, 0xFF000000.toInt()),
      colorSecondary = prefs.getInt(KEY_COLOR_SECONDARY, 0xFF000000.toInt()),
      position = prefs.getInt(KEY_POSITION, 0),
      duration = prefs.getInt(KEY_DURATION, 0),
      playlistsJson = prefs.getString(KEY_PLAYLISTS, "[]") ?: "[]",
      historyJson = prefs.getString(KEY_HISTORY, "[]") ?: "[]",
      latestJson = prefs.getString(KEY_LATEST, "[]") ?: "[]",
      recommendationsJson = prefs.getString(KEY_RECOMMENDATIONS, "[]") ?: "[]"
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
    colorSecondary: Int,
    position: Int,
    duration: Int,
    playlistsJson: String = prefs(context).getString(KEY_PLAYLISTS, "[]") ?: "[]",
    historyJson: String = prefs(context).getString(KEY_HISTORY, "[]") ?: "[]",
    latestJson: String = prefs(context).getString(KEY_LATEST, "[]") ?: "[]",
    recommendationsJson: String = prefs(context).getString(KEY_RECOMMENDATIONS, "[]") ?: "[]"
  ) {
    val prefs = prefs(context)
    val now = System.currentTimeMillis()
    val playModeOverrideUntil = prefs.getLong(KEY_PLAY_MODE_OVERRIDE_UNTIL, 0L)
    val likedOverrideUntil = prefs.getLong(KEY_IS_LIKED_OVERRIDE_UNTIL, 0L)
    val shouldWritePlayMode = playModeOverrideUntil <= now
    val shouldWriteLiked = likedOverrideUntil <= now

    val editor = prefs.edit()
      .putString(KEY_TITLE, title)
      .putString(KEY_ARTIST, artist)
      .putString(KEY_COVER, coverPath)
      .putBoolean(KEY_PLAYING, isPlaying)
      .putInt(KEY_COLOR_PRIMARY, colorPrimary)
      .putInt(KEY_COLOR_SECONDARY, colorSecondary)
      .putInt(KEY_POSITION, position)
      .putInt(KEY_DURATION, duration)
      .putString(KEY_PLAYLISTS, playlistsJson)
      .putString(KEY_HISTORY, historyJson)
      .putString(KEY_LATEST, latestJson)
      .putString(KEY_RECOMMENDATIONS, recommendationsJson)

    if (shouldWritePlayMode) {
      editor.putString(KEY_PLAY_MODE, playMode)
    }
    if (shouldWriteLiked) {
      editor.putBoolean(KEY_IS_LIKED, isLiked)
    }

    editor.apply()
  }

  fun saveCollections(
    context: Context,
    playlistsJson: String,
    historyJson: String,
    latestJson: String,
    recommendationsJson: String
  ) {
    prefs(context).edit()
      .putString(KEY_PLAYLISTS, playlistsJson)
      .putString(KEY_HISTORY, historyJson)
      .putString(KEY_LATEST, latestJson)
      .putString(KEY_RECOMMENDATIONS, recommendationsJson)
      .apply()
  }

  fun setPlayModeOverride(context: Context, mode: String, durationMs: Long = 2000L) {
    val until = System.currentTimeMillis() + durationMs
    prefs(context).edit()
      .putString(KEY_PLAY_MODE, mode)
      .putString(KEY_PLAY_MODE_OVERRIDE, mode)
      .putLong(KEY_PLAY_MODE_OVERRIDE_UNTIL, until)
      .apply()
  }

  fun setLikedOverride(context: Context, liked: Boolean, durationMs: Long = 2000L) {
    val until = System.currentTimeMillis() + durationMs
    prefs(context).edit()
      .putBoolean(KEY_IS_LIKED, liked)
      .putBoolean(KEY_IS_LIKED_OVERRIDE, liked)
      .putLong(KEY_IS_LIKED_OVERRIDE_UNTIL, until)
      .apply()
  }

  private fun resolvePlayMode(prefs: SharedPreferences): String {
    val until = prefs.getLong(KEY_PLAY_MODE_OVERRIDE_UNTIL, 0L)
    if (until > System.currentTimeMillis()) {
      val overrideValue = prefs.getString(KEY_PLAY_MODE_OVERRIDE, "") ?: ""
      if (overrideValue.isNotEmpty()) return overrideValue
    }
    return prefs.getString(KEY_PLAY_MODE, "") ?: ""
  }

  private fun resolveLiked(prefs: SharedPreferences): Boolean {
    val until = prefs.getLong(KEY_IS_LIKED_OVERRIDE_UNTIL, 0L)
    if (until > System.currentTimeMillis()) {
      return prefs.getBoolean(KEY_IS_LIKED_OVERRIDE, prefs.getBoolean(KEY_IS_LIKED, false))
    }
    return prefs.getBoolean(KEY_IS_LIKED, false)
  }
}
