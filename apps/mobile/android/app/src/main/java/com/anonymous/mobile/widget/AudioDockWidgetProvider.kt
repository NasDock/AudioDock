package com.anonymous.mobile.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import com.anonymous.mobile.R
import kotlin.math.roundToInt

open class AudioDockWidgetProvider : AppWidgetProvider() {

  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)
    when (intent.action) {
      ACTION_WIDGET_PLAY,
      ACTION_WIDGET_PAUSE,
      ACTION_WIDGET_NEXT,
      ACTION_WIDGET_PREV -> {
        val serviceIntent = Intent(context, WidgetTransportService::class.java).apply {
          action = intent.action
        }
        context.startService(serviceIntent)
      }
    }
  }

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

    const val ACTION_WIDGET_PLAY = "com.soundx.widget.PLAY"
    const val ACTION_WIDGET_PAUSE = "com.soundx.widget.PAUSE"
    const val ACTION_WIDGET_NEXT = "com.soundx.widget.NEXT"
    const val ACTION_WIDGET_PREV = "com.soundx.widget.PREV"
    private const val ACTION_MODE = WidgetCommandReceiver.ACTION_WIDGET_MODE
    private const val ACTION_LIKE = WidgetCommandReceiver.ACTION_WIDGET_LIKE
    private const val ACTION_UNLIKE = WidgetCommandReceiver.ACTION_WIDGET_UNLIKE

    fun updateAllWidgets(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val smallIds = manager.getAppWidgetIds(ComponentName(context, AudioDockWidgetProvider::class.java))
      val mediumIds = manager.getAppWidgetIds(ComponentName(context, AudioDockWidgetProviderMedium::class.java))
      val ids = (smallIds + mediumIds).distinct().toIntArray()
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
        val providerInfo = appWidgetManager.getAppWidgetInfo(appWidgetId)
        val layoutId = if (providerInfo?.provider?.className == AudioDockWidgetProviderMedium::class.java.name) {
          R.layout.widget_medium
        } else {
          resolveLayout(options)
        }
        val views = RemoteViews(context.packageName, layoutId)

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

        val (widthPx, heightPx) = resolveWidgetSize(context, options)
        val bgBitmap = WidgetImageUtils.themedGradientBackground(
          widthPx,
          heightPx,
          state.colorPrimary,
          state.colorSecondary
        )
        if (bgBitmap != null) {
          views.setImageViewBitmap(R.id.widget_bg, bgBitmap)
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

        if (layoutId == R.layout.widget_large || layoutId == R.layout.widget_medium) {
          val modeIcon = when (normalizePlayMode(state.playMode)) {
            "SHUFFLE" -> R.drawable.ic_widget_shuffle
            "LOOP_SINGLE" -> R.drawable.ic_widget_repeat_one
            "LOOP_LIST" -> R.drawable.ic_widget_repeat
            "SEQUENCE" -> R.drawable.ic_widget_sequence
            else -> R.drawable.ic_widget_repeat
          }
          val likeIcon = if (state.isLiked) R.drawable.ic_widget_heart_filled else R.drawable.ic_widget_heart
          views.setImageViewResource(R.id.widget_mode, modeIcon)
          views.setImageViewResource(R.id.widget_like, likeIcon)
        }

        val playIcon = if (state.isPlaying) {
          R.drawable.ic_widget_pause
        } else {
          R.drawable.ic_widget_play
        }
        views.setImageViewResource(R.id.widget_play_pause, playIcon)

        if (layoutId == R.layout.widget_medium) {
          views.setOnClickPendingIntent(R.id.widget_root, null)
        } else {
          views.setOnClickPendingIntent(
            R.id.widget_root,
            openPendingIntent(context)
          )
        }
        views.setOnClickPendingIntent(
          R.id.widget_prev,
          broadcastPendingIntent(context, ACTION_WIDGET_PREV, appWidgetId)
        )
        views.setOnClickPendingIntent(
          R.id.widget_play_pause,
          broadcastPendingIntent(
            context,
            if (state.isPlaying) ACTION_WIDGET_PAUSE else ACTION_WIDGET_PLAY,
            appWidgetId
          )
        )
        views.setOnClickPendingIntent(
          R.id.widget_next,
          broadcastPendingIntent(context, ACTION_WIDGET_NEXT, appWidgetId)
        )

        if (layoutId == R.layout.widget_large || layoutId == R.layout.widget_medium) {
          views.setOnClickPendingIntent(
            R.id.widget_mode,
            commandPendingIntent(context, ACTION_MODE)
          )
          views.setOnClickPendingIntent(
            R.id.widget_like,
            commandPendingIntent(
              context,
              if (state.isLiked) ACTION_UNLIKE else ACTION_LIKE
            )
          )
        }

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

    private fun openPendingIntent(context: Context): PendingIntent {
      val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
        ?: Intent(context, com.anonymous.mobile.MainActivity::class.java)
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      return PendingIntent.getActivity(context, "open".hashCode(), intent, flags)
    }

    private fun broadcastPendingIntent(context: Context, action: String, widgetId: Int): PendingIntent {
      val intent = Intent(context, AudioDockWidgetProvider::class.java).apply {
        this.action = action
        putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
      }
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      return PendingIntent.getBroadcast(context, action.hashCode(), intent, flags)
    }

    private fun commandPendingIntent(context: Context, action: String): PendingIntent {
      val intent = Intent(context, WidgetCommandReceiver::class.java).apply {
        this.action = action
      }
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      return PendingIntent.getBroadcast(context, action.hashCode(), intent, flags)
    }

    private fun normalizePlayMode(raw: String): String {
      return when (raw.uppercase()) {
        "SHUFFLE", "RANDOM" -> "SHUFFLE"
        "LOOP_SINGLE", "SINGLE_LOOP", "SINGLE" -> "LOOP_SINGLE"
        "LOOP_LIST", "LIST_LOOP", "LOOP" -> "LOOP_LIST"
        "SEQUENCE", "ORDER", "DEFAULT" -> "SEQUENCE"
        else -> raw
      }
    }

    private fun resolveWidgetSize(context: Context, options: Bundle?): Pair<Int, Int> {
      val density = context.resources.displayMetrics.density
      val widthDp = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH) ?: 180
      val heightDp = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT) ?: 180
      val widthPx = (widthDp * density).toInt().coerceAtLeast(1)
      val heightPx = (heightDp * density).toInt().coerceAtLeast(1)
      return Pair(widthPx, heightPx)
    }
    // Transport actions are handled in WidgetTransportService to avoid binding in a receiver.
  }
}
