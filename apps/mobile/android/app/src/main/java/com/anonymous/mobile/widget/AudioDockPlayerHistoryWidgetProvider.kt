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

class AudioDockPlayerHistoryWidgetProvider : AppWidgetProvider() {
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
    private const val ACTION_HISTORY = WidgetCommandReceiver.ACTION_WIDGET_HISTORY
    private const val ACTION_PLAY = "com.soundx.widget.PLAY"
    private const val ACTION_PAUSE = "com.soundx.widget.PAUSE"
    private const val ACTION_NEXT = "com.soundx.widget.NEXT"
    private const val ACTION_PREV = "com.soundx.widget.PREV"

    fun updateAllWidgets(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, AudioDockPlayerHistoryWidgetProvider::class.java))
      updateWidgets(context, manager, ids)
    }

    private fun updateWidgets(
      context: Context,
      appWidgetManager: AppWidgetManager,
      appWidgetIds: IntArray
    ) {
      if (appWidgetIds.isEmpty()) return
      val state = WidgetStore.load(context)
      val history = parseList(state.historyJson)
      for (appWidgetId in appWidgetIds) {
        val views = RemoteViews(context.packageName, R.layout.widget_player_history_large)

        views.setTextViewText(R.id.widget_title, state.title)
        views.setTextViewText(R.id.widget_artist, state.artist)

        val coverPath = state.coverPath
        if (!coverPath.isNullOrBlank()) {
          val bitmap = BitmapFactory.decodeFile(coverPath)
          if (bitmap != null) {
            views.setImageViewBitmap(R.id.widget_cover, bitmap)
          } else {
            views.setImageViewResource(R.id.widget_cover, android.R.color.transparent)
          }
        } else {
          views.setImageViewResource(R.id.widget_cover, android.R.color.transparent)
        }

        val (widthPx, heightPx) = resolveWidgetSize(context, appWidgetManager.getAppWidgetOptions(appWidgetId))
        val bgBitmap = if (!coverPath.isNullOrBlank()) {
          val bitmap = BitmapFactory.decodeFile(coverPath)
          if (bitmap != null) WidgetImageUtils.blurredBackground(bitmap, widthPx, heightPx) else null
        } else {
          null
        }
        if (bgBitmap != null) {
          views.setImageViewBitmap(R.id.widget_bg, bgBitmap)
        }

        val playIcon = if (state.isPlaying) R.drawable.ic_widget_pause else R.drawable.ic_widget_play
        views.setImageViewResource(R.id.widget_play_pause, playIcon)

        views.setOnClickPendingIntent(
          R.id.widget_prev,
          broadcastPendingIntent(context, ACTION_PREV, appWidgetId)
        )
        views.setOnClickPendingIntent(
          R.id.widget_play_pause,
          broadcastPendingIntent(context, if (state.isPlaying) ACTION_PAUSE else ACTION_PLAY, appWidgetId)
        )
        views.setOnClickPendingIntent(
          R.id.widget_next,
          broadcastPendingIntent(context, ACTION_NEXT, appWidgetId)
        )

        bindHistoryRow(context, views, history, 0,
          R.id.widget_history_cover_1,
          R.id.widget_history_title_1,
          R.id.widget_history_artist_1,
          R.id.widget_history_play_1
        )
        bindHistoryRow(context, views, history, 1,
          R.id.widget_history_cover_2,
          R.id.widget_history_title_2,
          R.id.widget_history_artist_2,
          R.id.widget_history_play_2
        )
        bindHistoryRow(context, views, history, 2,
          R.id.widget_history_cover_3,
          R.id.widget_history_title_3,
          R.id.widget_history_artist_3,
          R.id.widget_history_play_3
        )

        views.setOnClickPendingIntent(
          R.id.widget_history_root,
          openPendingIntent(context)
        )

        appWidgetManager.updateAppWidget(appWidgetId, views)
      }
    }

    private fun bindHistoryRow(
      context: Context,
      views: RemoteViews,
      history: List<JSONObject>,
      index: Int,
      coverId: Int,
      titleId: Int,
      artistId: Int,
      playId: Int
    ) {
      if (index >= history.size) {
        views.setImageViewResource(coverId, android.R.color.transparent)
        views.setTextViewText(titleId, "")
        views.setTextViewText(artistId, "")
        views.setOnClickPendingIntent(playId, null)
        return
      }

      val item = history[index]
      val title = item.optString("title", "未命名")
      val artist = item.optString("artist", "")
      val cover = resolveCoverValue(item)
      views.setTextViewText(titleId, title)
      views.setTextViewText(artistId, artist)

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
        action = ACTION_HISTORY
        putExtra("id", id)
      }
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      val pending = PendingIntent.getBroadcast(context, ("history_$id").hashCode(), intent, flags)
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

    private fun resolveWidgetSize(context: Context, options: android.os.Bundle?): Pair<Int, Int> {
      val density = context.resources.displayMetrics.density
      val widthDp = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH) ?: 250
      val heightDp = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT) ?: 250
      val widthPx = (widthDp * density).toInt().coerceAtLeast(1)
      val heightPx = (heightDp * density).toInt().coerceAtLeast(1)
      return Pair(widthPx, heightPx)
    }

    private fun broadcastPendingIntent(context: Context, action: String, widgetId: Int): PendingIntent {
      val intent = Intent(context, AudioDockWidgetProvider::class.java).apply {
        this.action = action
        putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
      }
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      return PendingIntent.getBroadcast(context, action.hashCode(), intent, flags)
    }

    private fun openPendingIntent(context: Context): PendingIntent {
      val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
        ?: Intent(context, com.anonymous.mobile.MainActivity::class.java)
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      return PendingIntent.getActivity(context, "open_history_widget".hashCode(), intent, flags)
    }
  }
}
