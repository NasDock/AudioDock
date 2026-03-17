package com.anonymous.mobile.widget

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableArray
import android.graphics.BitmapFactory
import androidx.core.graphics.ColorUtils
import androidx.palette.graphics.Palette
import org.json.JSONArray
import org.json.JSONObject

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
      val playMode = payload.getString("playMode") ?: ""
      val isLiked = if (payload.hasKey("isLiked") && !payload.isNull("isLiked")) {
        payload.getBoolean("isLiked")
      } else {
        false
      }
      val isPlaying = payload.getBoolean("isPlaying")

      val (primaryColor, secondaryColor) = resolveColors(coverPath)

      WidgetStore.save(
        reactContext,
        title,
        artist,
        coverPath,
        isPlaying,
        playMode,
        isLiked,
        primaryColor,
        secondaryColor
      )
      AudioDockWidgetProvider.updateAllWidgets(reactContext)
      AudioDockPlaylistWidgetProvider.updateAllWidgets(reactContext)
      AudioDockPlayerHistoryWidgetProvider.updateAllWidgets(reactContext)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("WIDGET_UPDATE_FAILED", e)
    }
  }

  @ReactMethod
  fun updateWidgetCollections(payload: ReadableMap, promise: Promise) {
    try {
      val playlistsJson = serializeList(payload.getArray("playlists"))
      val historyJson = serializeList(payload.getArray("history"))
      val latestJson = serializeList(payload.getArray("latest"))
      WidgetStore.saveCollections(reactContext, playlistsJson, historyJson, latestJson)
      AudioDockWidgetProvider.updateAllWidgets(reactContext)
      AudioDockPlaylistWidgetProvider.updateAllWidgets(reactContext)
      AudioDockPlayerHistoryWidgetProvider.updateAllWidgets(reactContext)
      AudioDockLatestTracksWidgetProvider.updateAllWidgets(reactContext)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("WIDGET_COLLECTIONS_UPDATE_FAILED", e)
    }
  }

  private fun serializeList(array: ReadableArray?): String {
    if (array == null) return "[]"
    val json = JSONArray()
    for (i in 0 until array.size()) {
      val map = array.getMap(i)
      if (map != null) {
        val obj = JSONObject()
        map.toHashMap().forEach { (key, value) ->
          obj.put(key, value)
        }
        json.put(obj)
      }
    }
    return json.toString()
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
