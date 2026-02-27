package com.anonymous.mobile.media

import android.content.Intent
import android.media.AudioManager
import android.os.SystemClock
import android.view.KeyEvent
import androidx.media.session.MediaButtonReceiver
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.Exception

class MediaControlBridgeModule : Module() {
  private var mediaSession: MediaSessionCompat? = null
  private var lastEventAtMs: Long = 0
  private var started = false

  override fun definition() = ModuleDefinition {
    Name("MediaControlBridge")

    // 定义事件
    Events("MediaControlBridgeEvent")

    // 开始监听
    Function("startListening") {
      try {
        ensureSession()
        mediaSession?.isActive = true
        started = true
        return@Function true
      } catch (e: Exception) {
        throw e
      }
    }

    // 停止监听
    Function("stopListening") {
      mediaSession?.isActive = false
      started = false
      return@Function true
    }

    OnDestroy {
      releaseSession()
    }
  }

  private fun ensureSession() {
    if (mediaSession != null) return
    
    // 获取 Expo 提供的 Context
    val context = appContext.reactContext ?: throw Exception("React context not available")
    
    mediaSession = MediaSessionCompat(context, "SoundXMediaBridge").apply {
      setFlags(
        MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS or
          MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
      )
      setPlaybackToLocal(AudioManager.STREAM_MUSIC)
      setPlaybackState(
        PlaybackStateCompat.Builder()
          .setState(PlaybackStateCompat.STATE_PAUSED, 0L, 1f)
          .setActions(
            PlaybackStateCompat.ACTION_PLAY or
              PlaybackStateCompat.ACTION_PAUSE or
              PlaybackStateCompat.ACTION_PLAY_PAUSE or
              PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
              PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
              PlaybackStateCompat.ACTION_SEEK_TO or
              PlaybackStateCompat.ACTION_FAST_FORWARD or
              PlaybackStateCompat.ACTION_REWIND
          )
          .build()
      )

      setCallback(object : MediaSessionCompat.Callback() {
        override fun onPlay() = emitAction("play")
        override fun onPause() = emitAction("pause")
        override fun onSkipToNext() = emitAction("next")
        override fun onSkipToPrevious() = emitAction("previous")
        override fun onSeekTo(pos: Long) = emitAction("seek", pos / 1000.0)
        override fun onFastForward() = emitAction("jumpForward", null, 15.0)
        override fun onRewind() = emitAction("jumpBackward", null, 15.0)

        override fun onMediaButtonEvent(mediaButtonEvent: Intent?): Boolean {
          val keyEvent = mediaButtonEvent?.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT)
          if (keyEvent != null && keyEvent.action == KeyEvent.ACTION_DOWN) {
            when (keyEvent.keyCode) {
              KeyEvent.KEYCODE_MEDIA_PLAY -> emitAction("play")
              KeyEvent.KEYCODE_MEDIA_PAUSE -> emitAction("pause")
              KeyEvent.KEYCODE_MEDIA_NEXT -> emitAction("next")
              KeyEvent.KEYCODE_MEDIA_PREVIOUS -> emitAction("previous")
              KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> emitAction("toggle")
              KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> emitAction("jumpForward", null, 15.0)
              KeyEvent.KEYCODE_MEDIA_REWIND -> emitAction("jumpBackward", null, 15.0)
            }
          }
          MediaButtonReceiver.handleIntent(this@apply, mediaButtonEvent)
          return true
        }
      })
    }
  }

  private fun emitAction(action: String, position: Double? = null, interval: Double? = null) {
    val now = SystemClock.elapsedRealtime()
    if (now - lastEventAtMs < 120) return
    lastEventAtMs = now

    val params = mapOf(
      "action" to action,
      "position" to position,
      "interval" to interval
    )

    sendEvent("MediaControlBridgeEvent", params)
  }

  private fun releaseSession() {
    mediaSession?.setCallback(null)
    mediaSession?.release()
    mediaSession = null
    started = false
  }
}
