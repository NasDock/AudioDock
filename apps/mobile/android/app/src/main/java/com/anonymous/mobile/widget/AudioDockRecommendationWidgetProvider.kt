package com.anonymous.mobile.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import com.anonymous.mobile.R
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.roundToInt

class AudioDockRecommendationWidgetProvider : AppWidgetProvider() {
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
    private const val ACTION_RECOMMENDATION = WidgetCommandReceiver.ACTION_WIDGET_RECOMMENDATION
    private const val ACTION_PLAY = "com.soundx.widget.PLAY"
    private const val ACTION_PAUSE = "com.soundx.widget.PAUSE"
    private const val ACTION_NEXT = "com.soundx.widget.NEXT"
    private const val ACTION_PREV = "com.soundx.widget.PREV"
    private const val ACTION_REFRESH = WidgetCommandReceiver.ACTION_WIDGET_REFRESH_RECOMMENDATION
    private const val MAIN_COVER_SIZE_DP = 120
    private const val ROW_COVER_SIZE_DP = 40

    fun updateAllWidgets(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(
        ComponentName(context, AudioDockRecommendationWidgetProvider::class.java)
      )
      updateWidgets(context, manager, ids)
    }

    private fun updateWidgets(
      context: Context,
      appWidgetManager: AppWidgetManager,
      appWidgetIds: IntArray
    ) {
      if (appWidgetIds.isEmpty()) return
      val state = WidgetStore.load(context)
      val recommendations = parseList(state.recommendationsJson)
      for (appWidgetId in appWidgetIds) {
        val views = RemoteViews(context.packageName, R.layout.widget_recommend_large)

        views.setTextViewText(R.id.widget_title, state.title)
        views.setTextViewText(R.id.widget_artist, state.artist)

        val coverPath = state.coverPath
        if (!coverPath.isNullOrBlank()) {
          val bitmap = WidgetImageUtils.decodeSampledBitmap(
            coverPath,
            dpToPx(context, MAIN_COVER_SIZE_DP),
            dpToPx(context, MAIN_COVER_SIZE_DP)
          )
          if (bitmap != null) {
            views.setImageViewBitmap(R.id.widget_cover, bitmap)
          } else {
            views.setImageViewResource(R.id.widget_cover, android.R.color.transparent)
          }
        } else {
          views.setImageViewResource(R.id.widget_cover, android.R.color.transparent)
        }

        val options = appWidgetManager.getAppWidgetOptions(appWidgetId)
        val (widthPx, heightPx) = resolveWidgetSize(context, options)
        val background = WidgetImageUtils.themedGradientBackground(
          widthPx,
          heightPx,
          state.colorPrimary,
          state.colorSecondary
        )
        if (background != null) {
          views.setImageViewBitmap(R.id.widget_bg, background)
        }

        val shouldShowProgress = state.duration > 0 && state.position >= 0
        val progress = if (shouldShowProgress) {
          ((state.position.toFloat() / state.duration.toFloat()) * 1000f).roundToInt()
            .coerceIn(0, 1000)
        } else {
          0
        }
        views.setViewVisibility(
          R.id.widget_progress,
          if (shouldShowProgress) View.VISIBLE else View.GONE
        )
        views.setProgressBar(R.id.widget_progress, 1000, progress, false)

        val playIcon = if (state.isPlaying) R.drawable.ic_widget_pause else R.drawable.ic_widget_play
        views.setImageViewResource(R.id.widget_play_pause, playIcon)

        bindRecommendationRow(
          context, views, recommendations, 0,
          R.id.widget_recommend_cover_1,
          R.id.widget_recommend_title_1,
          R.id.widget_recommend_artist_1,
          R.id.widget_recommend_play_1
        )
        bindRecommendationRow(
          context, views, recommendations, 1,
          R.id.widget_recommend_cover_2,
          R.id.widget_recommend_title_2,
          R.id.widget_recommend_artist_2,
          R.id.widget_recommend_play_2
        )
        bindRecommendationRow(
          context, views, recommendations, 2,
          R.id.widget_recommend_cover_3,
          R.id.widget_recommend_title_3,
          R.id.widget_recommend_artist_3,
          R.id.widget_recommend_play_3
        )
        bindRecommendationRow(
          context, views, recommendations, 3,
          R.id.widget_recommend_cover_4,
          R.id.widget_recommend_title_4,
          R.id.widget_recommend_artist_4,
          R.id.widget_recommend_play_4
        )

        views.setOnClickPendingIntent(
          R.id.widget_recommend_root,
          openPendingIntent(context)
        )
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
        views.setOnClickPendingIntent(
          R.id.widget_recommend_refresh,
          refreshPendingIntent(context)
        )

        appWidgetManager.updateAppWidget(appWidgetId, views)
      }
    }

    private fun bindRecommendationRow(
      context: Context,
      views: RemoteViews,
      recommendations: List<JSONObject>,
      index: Int,
      coverId: Int,
      titleId: Int,
      artistId: Int,
      playId: Int
    ) {
      if (index >= recommendations.size) {
        views.setImageViewResource(coverId, android.R.color.transparent)
        views.setTextViewText(titleId, "")
        views.setTextViewText(artistId, "")
        views.setOnClickPendingIntent(playId, null)
        return
      }

      val item = recommendations[index]
      val title = item.optString("title", "未命名")
      val artist = item.optString("artist", "")
      val cover = resolveCoverValue(item)
      views.setTextViewText(titleId, title)
      views.setTextViewText(artistId, artist)

      if (cover.isNotEmpty()) {
        val path = resolveCoverPath(context, cover)
        val bitmap = WidgetImageUtils.decodeSampledBitmap(
          path,
          dpToPx(context, ROW_COVER_SIZE_DP),
          dpToPx(context, ROW_COVER_SIZE_DP)
        )
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
        action = ACTION_RECOMMENDATION
        putExtra("id", id)
      }
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      val pending = PendingIntent.getBroadcast(context, ("recommend_$id").hashCode(), intent, flags)
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

    private fun dpToPx(context: Context, valueDp: Int): Int {
      return (valueDp * context.resources.displayMetrics.density).roundToInt().coerceAtLeast(1)
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
      return PendingIntent.getActivity(context, "open_recommend_widget".hashCode(), intent, flags)
    }

    private fun refreshPendingIntent(context: Context): PendingIntent {
      val intent = Intent(context, WidgetCommandReceiver::class.java).apply {
        action = ACTION_REFRESH
      }
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      return PendingIntent.getBroadcast(context, ACTION_REFRESH.hashCode(), intent, flags)
    }
  }
}
