package com.anonymous.mobile.widget

import android.app.Service
import android.content.ComponentName
import android.content.Intent
import android.os.IBinder
import androidx.core.content.ContextCompat
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.doublesymmetry.trackplayer.service.MusicService

class WidgetTransportService : Service() {
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val action = intent?.action
    if (action.isNullOrBlank()) {
      stopSelfResult(startId)
      return START_NOT_STICKY
    }

    val sessionToken = SessionToken(this, ComponentName(this, MusicService::class.java))
    val controllerFuture = MediaController.Builder(this, sessionToken).buildAsync()
    controllerFuture.addListener({
      try {
        val controller = controllerFuture.get()
        when (action) {
          AudioDockWidgetProvider.ACTION_WIDGET_PLAY -> controller.play()
          AudioDockWidgetProvider.ACTION_WIDGET_PAUSE -> controller.pause()
          AudioDockWidgetProvider.ACTION_WIDGET_NEXT -> controller.seekToNext()
          AudioDockWidgetProvider.ACTION_WIDGET_PREV -> controller.seekToPrevious()
        }
        controller.release()
      } catch (_: Exception) {
        // no-op
      } finally {
        stopSelfResult(startId)
      }
    }, ContextCompat.getMainExecutor(this))

    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
