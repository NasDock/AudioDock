package com.anonymous.mobile.widget

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap

class WidgetBridgeModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "WidgetBridge"

  @ReactMethod
  fun updateWidget(payload: ReadableMap, promise: Promise) {
    try {
      val title = payload.getString("title") ?: "未在播放"
      val artist = payload.getString("artist") ?: ""
      val coverPath = if (payload.hasKey("coverPath") && !payload.isNull("coverPath")) {
        val rawPath = payload.getString("coverPath")
        rawPath?.removePrefix("file://")
      } else {
        null
      }
      val isPlaying = payload.getBoolean("isPlaying")

      WidgetStore.save(reactContext, title, artist, coverPath, isPlaying)
      AudioDockWidgetProvider.updateAllWidgets(reactContext)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("WIDGET_UPDATE_FAILED", e)
    }
  }
}
