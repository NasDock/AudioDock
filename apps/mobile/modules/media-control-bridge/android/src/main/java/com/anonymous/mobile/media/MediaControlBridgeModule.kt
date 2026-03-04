package com.anonymous.mobile.media

import android.content.Intent
import android.media.AudioManager
import android.os.SystemClock
import android.view.KeyEvent
import android.support.v4.media.MediaMetadataCompat
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

    Events("MediaControlBridgeEvent")

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

    Function("stopListening") {
      mediaSession?.isActive = false
      started = false
      return@Function true
    }

    Function("updatePlaybackState") { state: String, position: Double?, speed: Double?, canSkipNext: Boolean, canSkipPrevious: Boolean ->
      ensureSession()
      applyPlaybackState(
        state = state,
        positionMs = ((position ?: 0.0) * 1000.0).toLong(),
        speed = (speed ?: 1.0).toFloat(),
        canSkipNext = canSkipNext,
        canSkipPrevious = canSkipPrevious
      )
      return@Function true
    }

    Function("updateMetadata") { title: String?, artist: String?, album: String?, duration: Double? ->
      ensureSession()
      val metadata = MediaMetadataCompat.Builder().apply {
        putString(MediaMetadataCompat.METADATA_KEY_TITLE, title ?: "")
        putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist ?: "")
        putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album ?: "")
        putLong(MediaMetadataCompat.METADATA_KEY_DURATION, ((duration ?: 0.0) * 1000.0).toLong())
      }.build()
      mediaSession?.setMetadata(metadata)
      return@Function true
    }

    OnDestroy {
      releaseSession()
    }
  }

  private fun ensureSession() {
    if (mediaSession != null) return
    
    val context = appContext.reactContext ?: throw Exception("React context not available")
    
    mediaSession = MediaSessionCompat(context, "SoundXMediaBridge").apply {
      setFlags(
        MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS or
          MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS or
          MediaSessionCompat.FLAG_HANDLES_QUEUE_COMMANDS
      )
      setPlaybackToLocal(AudioManager.STREAM_MUSIC)

      applyPlaybackState(
        state = "paused",
        positionMs = 0L,
        speed = 1.0f,
        canSkipNext = true,
        canSkipPrevious = true
      )

      setCallback(object : MediaSessionCompat.Callback() {
        override fun onPlay() { emitAction("play") }
        override fun onPause() { emitAction("pause") }
        override fun onSkipToNext() { emitAction("next") }
        override fun onSkipToPrevious() { emitAction("previous") }
        override fun onSeekTo(pos: Long) { emitAction("seek", pos / 1000.0) }
        override fun onFastForward() { emitAction("jumpForward", null, 15.0) }
        override fun onRewind() { emitAction("jumpBackward", null, 15.0) }

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
              KeyEvent.KEYCODE_HEADSETHOOK -> emitAction("toggle")
            }
          }
          // 重要：不调用 handleIntent，完全接管
          return true
        }
      })
    }
  }

  private fun applyPlaybackState(
    state: String,
    positionMs: Long,
    speed: Float,
    canSkipNext: Boolean,
    canSkipPrevious: Boolean
  ) {
    val compatState = when (state.lowercase()) {
      "playing" -> PlaybackStateCompat.STATE_PLAYING
      "buffering", "loading" -> PlaybackStateCompat.STATE_BUFFERING
      "stopped" -> PlaybackStateCompat.STATE_STOPPED
      "none", "idle" -> PlaybackStateCompat.STATE_NONE
      else -> PlaybackStateCompat.STATE_PAUSED
    }

    var actions =
      PlaybackStateCompat.ACTION_PLAY or
        PlaybackStateCompat.ACTION_PAUSE or
        PlaybackStateCompat.ACTION_PLAY_PAUSE or
        PlaybackStateCompat.ACTION_SEEK_TO or
        PlaybackStateCompat.ACTION_FAST_FORWARD or
        PlaybackStateCompat.ACTION_REWIND

    if (canSkipNext) {
      actions = actions or PlaybackStateCompat.ACTION_SKIP_TO_NEXT
    }
    if (canSkipPrevious) {
      actions = actions or PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
    }

    mediaSession?.setPlaybackState(
      PlaybackStateCompat.Builder()
        .setState(compatState, positionMs, speed)
        .setActions(actions)
        .build()
    )
  }

  private fun emitAction(action: String, position: Double? = null, interval: Double? = null) {
    val now = SystemClock.elapsedRealtime()
    if (now - lastEventAtMs < 200) return // 稍微增加抖动时间
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
