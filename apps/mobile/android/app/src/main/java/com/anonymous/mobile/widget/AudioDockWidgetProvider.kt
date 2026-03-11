package com.anonymous.mobile.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.widget.RemoteViews
import com.anonymous.mobile.R

class AudioDockWidgetProvider : AppWidgetProvider() {

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
    newOptions: Bundle
  ) {
    updateWidgets(context, appWidgetManager, intArrayOf(appWidgetId))
  }

  companion object {
    private const val ACTION_PLAY = "play"
    private const val ACTION_PAUSE = "pause"
    private const val ACTION_PREV = "prev"
    private const val ACTION_NEXT = "next"

    fun updateAllWidgets(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, AudioDockWidgetProvider::class.java))
      updateWidgets(context, manager, ids)
    }

    private fun updateWidgets(
      context: Context,
      appWidgetManager: AppWidgetManager,
      appWidgetIds: IntArray
    ) {
      if (appWidgetIds.isEmpty()) return

      val state = WidgetStore.load(context)
      for (appWidgetId in appWidgetIds) {
        val options = appWidgetManager.getAppWidgetOptions(appWidgetId)
        val layoutId = resolveLayout(options)
        val views = RemoteViews(context.packageName, layoutId)

        views.setTextViewText(R.id.widget_title, state.title)
        views.setTextViewText(R.id.widget_artist, state.artist)

        val coverPath = state.coverPath
        if (!coverPath.isNullOrBlank()) {
          val bitmap = BitmapFactory.decodeFile(coverPath)
          if (bitmap != null) {
            views.setImageViewBitmap(R.id.widget_cover, bitmap)
          } else {
            views.setImageViewResource(R.id.widget_cover, R.mipmap.ic_launcher)
          }
        } else {
          views.setImageViewResource(R.id.widget_cover, R.mipmap.ic_launcher)
        }

        val playIcon = if (state.isPlaying) {
          R.drawable.ic_widget_pause
        } else {
          R.drawable.ic_widget_play
        }
        views.setImageViewResource(R.id.widget_play_pause, playIcon)

        views.setOnClickPendingIntent(
          R.id.widget_root,
          actionPendingIntent(context, ACTION_PLAY)
        )
        views.setOnClickPendingIntent(
          R.id.widget_prev,
          actionPendingIntent(context, ACTION_PREV)
        )
        views.setOnClickPendingIntent(
          R.id.widget_play_pause,
          actionPendingIntent(context, if (state.isPlaying) ACTION_PAUSE else ACTION_PLAY)
        )
        views.setOnClickPendingIntent(
          R.id.widget_next,
          actionPendingIntent(context, ACTION_NEXT)
        )

        appWidgetManager.updateAppWidget(appWidgetId, views)
      }
    }

    private fun resolveLayout(options: Bundle?): Int {
      if (options == null) return R.layout.widget_small

      val minWidth = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH)
      val minHeight = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT)

      return when {
        minWidth >= 180 && minHeight >= 180 -> R.layout.widget_large
        minWidth >= 180 -> R.layout.widget_medium
        else -> R.layout.widget_small
      }
    }

    private fun actionPendingIntent(context: Context, action: String): PendingIntent {
      val uri = Uri.parse("audiodock://widget?action=$action")
      val intent = Intent(Intent.ACTION_VIEW, uri).apply {
        `package` = context.packageName
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      }
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      return PendingIntent.getActivity(context, action.hashCode(), intent, flags)
    }
  }
}
