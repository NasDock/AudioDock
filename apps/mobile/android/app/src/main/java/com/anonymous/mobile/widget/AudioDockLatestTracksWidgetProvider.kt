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

class AudioDockLatestTracksWidgetProvider : AppWidgetProvider() {
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
    private const val ACTION_LATEST = WidgetCommandReceiver.ACTION_WIDGET_LATEST
    private const val ACTION_REFRESH = WidgetCommandReceiver.ACTION_WIDGET_REFRESH_LATEST
    private const val ACTION_PLAY = "com.soundx.widget.PLAY"
    private const val ACTION_PAUSE = "com.soundx.widget.PAUSE"

    fun updateAllWidgets(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, AudioDockLatestTracksWidgetProvider::class.java))
      updateWidgets(context, manager, ids)
    }

    private fun updateWidgets(
      context: Context,
      appWidgetManager: AppWidgetManager,
      appWidgetIds: IntArray
    ) {
      if (appWidgetIds.isEmpty()) return
      val state = WidgetStore.load(context)
      val latest = parseList(state.latestJson)
      for (appWidgetId in appWidgetIds) {
        val views = RemoteViews(context.packageName, R.layout.widget_latest_tracks_large)

        val options = appWidgetManager.getAppWidgetOptions(appWidgetId)
        val (widthPx, heightPx) = resolveWidgetSize(context, options)
        val background = resolveBackground(context, latest, widthPx, heightPx)
        if (background != null) {
          views.setImageViewBitmap(R.id.widget_bg, background)
        }

        val playIcon = if (state.isPlaying) R.drawable.ic_widget_pause else R.drawable.ic_widget_play
        views.setImageViewResource(R.id.widget_latest_play_pause, playIcon)

        bindLatestRow(context, views, latest, 0,
          R.id.widget_latest_cover_1,
          R.id.widget_latest_title_1,
          R.id.widget_latest_artist_1,
          R.id.widget_latest_play_1
        )
        bindLatestRow(context, views, latest, 1,
          R.id.widget_latest_cover_2,
          R.id.widget_latest_title_2,
          R.id.widget_latest_artist_2,
          R.id.widget_latest_play_2
        )
        bindLatestRow(context, views, latest, 2,
          R.id.widget_latest_cover_3,
          R.id.widget_latest_title_3,
          R.id.widget_latest_artist_3,
          R.id.widget_latest_play_3
        )
        bindLatestRow(context, views, latest, 3,
          R.id.widget_latest_cover_4,
          R.id.widget_latest_title_4,
          R.id.widget_latest_artist_4,
          R.id.widget_latest_play_4
        )
        bindLatestRow(context, views, latest, 4,
          R.id.widget_latest_cover_5,
          R.id.widget_latest_title_5,
          R.id.widget_latest_artist_5,
          R.id.widget_latest_play_5
        )

        views.setOnClickPendingIntent(
          R.id.widget_latest_root,
          openPendingIntent(context)
        )
        views.setOnClickPendingIntent(
          R.id.widget_latest_play_pause,
          broadcastPendingIntent(
            context,
            if (state.isPlaying) ACTION_PAUSE else ACTION_PLAY,
            appWidgetId
          )
        )
        views.setOnClickPendingIntent(
          R.id.widget_latest_refresh,
          refreshPendingIntent(context)
        )

        appWidgetManager.updateAppWidget(appWidgetId, views)
      }
    }

    private fun bindLatestRow(
      context: Context,
      views: RemoteViews,
      latest: List<JSONObject>,
      index: Int,
      coverId: Int,
      titleId: Int,
      artistId: Int,
      playId: Int
    ) {
      if (index >= latest.size) {
        views.setImageViewResource(coverId, android.R.color.transparent)
        views.setTextViewText(titleId, "")
        views.setTextViewText(artistId, "")
        views.setOnClickPendingIntent(playId, null)
        return
      }

      val item = latest[index]
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
        action = ACTION_LATEST
        putExtra("id", id)
      }
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      val pending = PendingIntent.getBroadcast(context, ("latest_$id").hashCode(), intent, flags)
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
      latest: List<JSONObject>,
      widthPx: Int,
      heightPx: Int
    ): android.graphics.Bitmap? {
      val first = latest.firstOrNull() ?: return null
      val cover = resolveCoverValue(first)
      if (cover.isEmpty()) return null
      val path = resolveCoverPath(context, cover)
      val bitmap = BitmapFactory.decodeFile(path) ?: return null
      return WidgetImageUtils.blurredBackground(bitmap, widthPx, heightPx)
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
      return PendingIntent.getActivity(context, "open_latest_widget".hashCode(), intent, flags)
    }

    private fun refreshPendingIntent(context: Context): PendingIntent {
      val intent = Intent(context, WidgetCommandReceiver::class.java).apply {
        this.action = ACTION_REFRESH
      }
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      return PendingIntent.getBroadcast(context, ACTION_REFRESH.hashCode(), intent, flags)
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
