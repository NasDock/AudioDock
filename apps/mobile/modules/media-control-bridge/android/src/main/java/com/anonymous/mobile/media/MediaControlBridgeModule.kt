package com.anonymous.mobile.media

import android.content.Intent
import android.media.AudioManager
import android.os.Bundle
import android.os.SystemClock
import android.view.KeyEvent
import androidx.media.session.MediaButtonReceiver
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class MediaControlBridgeModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

  private var mediaSession: MediaSessionCompat? = null
  private var lastEventAtMs: Long = 0
  private var started = false

  init {
    reactContext.addLifecycleEventListener(this)
  }

  override fun getName(): String = "MediaControlBridge"

  @ReactMethod
  fun startListening(promise: Promise) {
    try {
      ensureSession()
      mediaSession?.isActive = true
      started = true
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("E_MEDIA_BRIDGE_START", e)
    }
  }

  @ReactMethod
  fun stopListening(promise: Promise) {
    try {
      mediaSession?.isActive = false
      started = false
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("E_MEDIA_BRIDGE_STOP", e)
    }
  }

  private fun ensureSession() {
    if (mediaSession != null) return

    mediaSession = MediaSessionCompat(reactContext, "SoundXMediaBridge").apply {
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
    // Basic debounce to avoid duplicated callbacks from different stacks.
    val now = SystemClock.elapsedRealtime()
    if (now - lastEventAtMs < 120) return
    lastEventAtMs = now

    val params = Arguments.createMap().apply {
      putString("action", action)
      if (position != null) putDouble("position", position)
      if (interval != null) putDouble("interval", interval)
    }

    sendEvent("MediaControlBridgeEvent", params)
  }

  private fun sendEvent(eventName: String, params: Any?) {
    if (!reactContext.hasActiveReactInstance()) return
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(eventName, params)
  }

  override fun onHostResume() {
    if (started) mediaSession?.isActive = true
  }

  override fun onHostPause() {}

  override fun onHostDestroy() {
    mediaSession?.setCallback(null)
    mediaSession?.release()
    mediaSession = null
    started = false
  }
}
