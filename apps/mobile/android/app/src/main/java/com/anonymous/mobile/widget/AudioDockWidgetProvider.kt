package com.anonymous.mobile.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.Shader
import android.net.Uri
import android.os.Bundle
import android.widget.RemoteViews
import androidx.core.content.ContextCompat
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.doublesymmetry.trackplayer.service.MusicService
import com.anonymous.mobile.R

class AudioDockWidgetProvider : AppWidgetProvider() {

  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)
    when (intent.action) {
      ACTION_WIDGET_PLAY -> sendTransportAction(context) { it.play() }
      ACTION_WIDGET_PAUSE -> sendTransportAction(context) { it.pause() }
      ACTION_WIDGET_NEXT -> sendTransportAction(context) { it.seekToNext() }
      ACTION_WIDGET_PREV -> sendTransportAction(context) { it.seekToPrevious() }
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

    private const val ACTION_WIDGET_PLAY = "com.soundx.widget.PLAY"
    private const val ACTION_WIDGET_PAUSE = "com.soundx.widget.PAUSE"
    private const val ACTION_WIDGET_NEXT = "com.soundx.widget.NEXT"
    private const val ACTION_WIDGET_PREV = "com.soundx.widget.PREV"

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

        if (layoutId == R.layout.widget_large) {
          views.setTextViewText(R.id.widget_lyric, state.lyric)
          views.setProgressBar(R.id.widget_progress, 1000, (state.progress * 1000).toInt(), false)
        }

        val (widthPx, heightPx) = resolveWidgetSize(context, options)
        val bgBitmap = gradientBitmap(widthPx, heightPx, state.colorPrimary, state.colorSecondary)
        if (bgBitmap != null) {
          views.setImageViewBitmap(R.id.widget_bg, bgBitmap)
        }

        val playIcon = if (state.isPlaying) {
          R.drawable.ic_widget_pause
        } else {
          R.drawable.ic_widget_play
        }
        views.setImageViewResource(R.id.widget_play_pause, playIcon)

        views.setOnClickPendingIntent(
          R.id.widget_root,
          openPendingIntent(context)
        )
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
      val uri = Uri.parse("audiodock://widget?open=player")
      val intent = Intent(Intent.ACTION_VIEW, uri).apply {
        `package` = context.packageName
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      }
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

    private fun resolveWidgetSize(context: Context, options: Bundle?): Pair<Int, Int> {
      val density = context.resources.displayMetrics.density
      val widthDp = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH) ?: 180
      val heightDp = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT) ?: 180
      val widthPx = (widthDp * density).toInt().coerceAtLeast(1)
      val heightPx = (heightDp * density).toInt().coerceAtLeast(1)
      return Pair(widthPx, heightPx)
    }

    private fun gradientBitmap(width: Int, height: Int, startColor: Int, endColor: Int): Bitmap? {
      if (width <= 0 || height <= 0) return null
      val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
      val canvas = Canvas(bitmap)
      val paint = Paint(Paint.ANTI_ALIAS_FLAG)
      paint.shader = LinearGradient(
        0f, 0f, width.toFloat(), height.toFloat(),
        startColor, endColor, Shader.TileMode.CLAMP
      )
      canvas.drawRect(Rect(0, 0, width, height), paint)
      return bitmap
    }

    private fun sendTransportAction(context: Context, action: (MediaController) -> Unit) {
      val sessionToken = SessionToken(context, ComponentName(context, MusicService::class.java))
      val controllerFuture = MediaController.Builder(context, sessionToken).buildAsync()
      controllerFuture.addListener({
        try {
          val controller = controllerFuture.get()
          action(controller)
          controller.release()
        } catch (_: Exception) {
          // no-op
        }
      }, ContextCompat.getMainExecutor(context))
    }
  }
}
