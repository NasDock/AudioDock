package com.anonymous.mobile.widget

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import android.graphics.BitmapFactory
import androidx.core.graphics.ColorUtils
import androidx.palette.graphics.Palette

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
      val lyric = payload.getString("lyric") ?: ""
      val progress = if (payload.hasKey("progress") && !payload.isNull("progress")) {
        payload.getDouble("progress").toFloat()
      } else {
        0f
      }
      val isPlaying = payload.getBoolean("isPlaying")

      val (primaryColor, secondaryColor) = resolveColors(coverPath)

      WidgetStore.save(
        reactContext,
        title,
        artist,
        coverPath,
        isPlaying,
        lyric,
        progress,
        primaryColor,
        secondaryColor
      )
      AudioDockWidgetProvider.updateAllWidgets(reactContext)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("WIDGET_UPDATE_FAILED", e)
    }
  }

  private fun resolveColors(coverPath: String?): Pair<Int, Int> {
    if (coverPath.isNullOrBlank()) {
      return Pair(0xFF000000.toInt(), 0xFF000000.toInt())
    }

    return try {
      val bitmap = BitmapFactory.decodeFile(coverPath)
      if (bitmap == null) {
        Pair(0xFF000000.toInt(), 0xFF000000.toInt())
      } else {
        val palette = Palette.from(bitmap).generate()
        val dominant = palette.getDominantColor(0xFF000000.toInt())
        val darker = ColorUtils.blendARGB(dominant, 0xFF000000.toInt(), 0.45f)
        Pair(dominant, darker)
      }
    } catch (_: Exception) {
      Pair(0xFF000000.toInt(), 0xFF000000.toInt())
    }
  }
}
