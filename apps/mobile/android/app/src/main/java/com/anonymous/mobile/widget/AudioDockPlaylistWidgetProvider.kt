package com.anonymous.mobile.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.widget.RemoteViews
import com.anonymous.mobile.R
import org.json.JSONArray
import org.json.JSONObject

class AudioDockPlaylistWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray
  ) {
    updateWidgets(context, appWidgetManager, appWidgetIds)
  }

  override fun onAppWidgetOptionsChanged(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetId: Int,
    newOptions: android.os.Bundle
  ) {
    updateWidgets(context, appWidgetManager, intArrayOf(appWidgetId))
  }

  companion object {
    private const val ACTION_PLAYLIST = WidgetCommandReceiver.ACTION_WIDGET_PLAYLIST
    private const val ACTION_PLAY = "com.soundx.widget.PLAY"
    private const val ACTION_PAUSE = "com.soundx.widget.PAUSE"

    fun updateAllWidgets(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, AudioDockPlaylistWidgetProvider::class.java))
      updateWidgets(context, manager, ids)
    }

    private fun updateWidgets(
      context: Context,
      appWidgetManager: AppWidgetManager,
      appWidgetIds: IntArray
    ) {
      if (appWidgetIds.isEmpty()) return
      val state = WidgetStore.load(context)
      val playlists = parseList(state.playlistsJson)
      for (appWidgetId in appWidgetIds) {
        val views = RemoteViews(context.packageName, R.layout.widget_playlist_large)
        views.setTextViewText(R.id.widget_title, "播放列表")

        val options = appWidgetManager.getAppWidgetOptions(appWidgetId)
        val (widthPx, heightPx) = resolveWidgetSize(context, options)
        val background = resolveBackground(context, playlists, widthPx, heightPx)
        if (background != null) {
          views.setImageViewBitmap(R.id.widget_bg, background)
        }

        val playIcon = if (state.isPlaying) R.drawable.ic_widget_pause else R.drawable.ic_widget_play
        views.setImageViewResource(R.id.widget_playlist_play_pause, playIcon)

        bindPlaylistRow(context, views, playlists, 0,
          R.id.widget_playlist_row_1,
          R.id.widget_playlist_cover_1,
          R.id.widget_playlist_name_1,
          R.id.widget_playlist_play_1
        )
        bindPlaylistRow(context, views, playlists, 1,
          R.id.widget_playlist_row_2,
          R.id.widget_playlist_cover_2,
          R.id.widget_playlist_name_2,
          R.id.widget_playlist_play_2
        )
        bindPlaylistRow(context, views, playlists, 2,
          R.id.widget_playlist_row_3,
          R.id.widget_playlist_cover_3,
          R.id.widget_playlist_name_3,
          R.id.widget_playlist_play_3
        )

        views.setOnClickPendingIntent(
          R.id.widget_playlist_root,
          openPendingIntent(context)
        )
        val headerIntent = if (state.isPlaying) {
          broadcastPendingIntent(context, ACTION_PAUSE, appWidgetId)
        } else {
          val firstId = playlists.firstOrNull()?.optString("id", "") ?: ""
          if (firstId.isNotEmpty()) {
            val intent = Intent(context, WidgetCommandReceiver::class.java).apply {
              action = ACTION_PLAYLIST
              putExtra("id", firstId)
            }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            PendingIntent.getBroadcast(context, ("playlist_header_$firstId").hashCode(), intent, flags)
          } else {
            broadcastPendingIntent(context, ACTION_PLAY, appWidgetId)
          }
        }
        views.setOnClickPendingIntent(R.id.widget_playlist_play_pause, headerIntent)

        appWidgetManager.updateAppWidget(appWidgetId, views)
      }
    }

    private fun bindPlaylistRow(
      context: Context,
      views: RemoteViews,
      playlists: List<JSONObject>,
      index: Int,
      rowId: Int,
      coverId: Int,
      nameId: Int,
      playId: Int
    ) {
      if (index >= playlists.size) {
        views.setViewVisibility(rowId, android.view.View.GONE)
        views.setImageViewResource(coverId, android.R.color.transparent)
        views.setTextViewText(nameId, "")
        views.setImageViewResource(playId, android.R.color.transparent)
        views.setOnClickPendingIntent(playId, null)
        return
      }

      views.setViewVisibility(rowId, android.view.View.VISIBLE)

      val item = playlists[index]
      val name = item.optString("name", "播放列表")
      val cover = resolveCoverValue(item)
      views.setTextViewText(nameId, name)

      if (cover.isNotEmpty()) {
        val path = resolveCoverPath(context, cover)
        val bitmap = BitmapFactory.decodeFile(path)
        if (bitmap != null) {
          views.setImageViewBitmap(coverId, bitmap)
        } else {
          views.setImageViewResource(coverId, android.R.color.transparent)
        }
      } else {
        views.setImageViewResource(coverId, android.R.color.transparent)
      }

      val id = item.optString("id", "")
      val intent = Intent(context, WidgetCommandReceiver::class.java).apply {
        action = ACTION_PLAYLIST
        putExtra("id", id)
      }
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      val pending = PendingIntent.getBroadcast(context, ("playlist_$id").hashCode(), intent, flags)
      views.setOnClickPendingIntent(playId, pending)
    }

    private fun parseList(raw: String): List<JSONObject> {
      return try {
        val arr = JSONArray(raw)
        (0 until arr.length()).map { arr.getJSONObject(it) }
      } catch (_: Exception) {
        emptyList()
      }
    }

    private fun resolveCoverPath(context: Context, value: String): String {
      if (value.startsWith("/")) {
        return value
      }
      val container = context.getExternalFilesDir(null) ?: context.filesDir
      return container.resolve(value).absolutePath
    }

    private fun resolveCoverValue(item: JSONObject): String {
      val cover = item.optString("cover", "")
      if (cover.isNotEmpty()) return cover
      return item.optString("coverPath", "")
    }

    private fun resolveBackground(
      context: Context,
      playlists: List<JSONObject>,
      widthPx: Int,
      heightPx: Int
    ): android.graphics.Bitmap? {
      val first = playlists.firstOrNull() ?: return null
      val cover = resolveCoverValue(first)
      if (cover.isEmpty()) return null
      val path = resolveCoverPath(context, cover)
      val bitmap = BitmapFactory.decodeFile(path) ?: return null
      return blurredBackground(bitmap, widthPx, heightPx)
    }

    private fun blurredBackground(source: android.graphics.Bitmap, targetWidth: Int, targetHeight: Int): android.graphics.Bitmap? {
      val scale = 0.12f
      val downW = (targetWidth * scale).toInt().coerceAtLeast(1)
      val downH = (targetHeight * scale).toInt().coerceAtLeast(1)
      val down = android.graphics.Bitmap.createScaledBitmap(source, downW, downH, true)
      return android.graphics.Bitmap.createScaledBitmap(down, targetWidth, targetHeight, true)
    }

    private fun resolveWidgetSize(context: Context, options: android.os.Bundle?): Pair<Int, Int> {
      val density = context.resources.displayMetrics.density
      val widthDp = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH) ?: 250
      val heightDp = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT) ?: 250
      val widthPx = (widthDp * density).toInt().coerceAtLeast(1)
      val heightPx = (heightDp * density).toInt().coerceAtLeast(1)
      return Pair(widthPx, heightPx)
    }

    private fun openPendingIntent(context: Context): PendingIntent {
      val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
        ?: Intent(context, com.anonymous.mobile.MainActivity::class.java)
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      return PendingIntent.getActivity(context, "open_playlist_widget".hashCode(), intent, flags)
    }

    private fun broadcastPendingIntent(context: Context, action: String, widgetId: Int): PendingIntent {
      val intent = Intent(context, AudioDockWidgetProvider::class.java).apply {
        this.action = action
        putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
      }
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      return PendingIntent.getBroadcast(context, action.hashCode(), intent, flags)
    }
  }
}
