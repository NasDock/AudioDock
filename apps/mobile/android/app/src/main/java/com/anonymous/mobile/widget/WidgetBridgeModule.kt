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
import kotlin.math.roundToInt

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
      val position = if (payload.hasKey("position") && !payload.isNull("position")) {
        payload.getDouble("position").roundToInt()
      } else {
        0
      }
      val duration = if (payload.hasKey("duration") && !payload.isNull("duration")) {
        payload.getDouble("duration").roundToInt()
      } else {
        0
      }

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
        secondaryColor,
        position,
        duration
      )
      AudioDockWidgetProvider.updateAllWidgets(reactContext)
      AudioDockPlaylistWidgetProvider.updateAllWidgets(reactContext)
      AudioDockPlayerHistoryWidgetProvider.updateAllWidgets(reactContext)
      AudioDockRecommendationWidgetProvider.updateAllWidgets(reactContext)
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
      val recommendationsJson = serializeList(payload.getArray("recommendations"))
      WidgetStore.saveCollections(
        reactContext,
        playlistsJson,
        historyJson,
        latestJson,
        recommendationsJson
      )
      AudioDockWidgetProvider.updateAllWidgets(reactContext)
      AudioDockPlaylistWidgetProvider.updateAllWidgets(reactContext)
      AudioDockPlayerHistoryWidgetProvider.updateAllWidgets(reactContext)
      AudioDockLatestTracksWidgetProvider.updateAllWidgets(reactContext)
      AudioDockRecommendationWidgetProvider.updateAllWidgets(reactContext)
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
        resolveThemeColors(palette)
      }
    } catch (_: Exception) {
      Pair(0xFF000000.toInt(), 0xFF000000.toInt())
    }
  }

  private fun resolveThemeColors(palette: Palette): Pair<Int, Int> {
    val swatches = listOf(
      palette.vibrantSwatch,
      palette.mutedSwatch,
      palette.darkVibrantSwatch,
      palette.darkMutedSwatch,
      palette.lightVibrantSwatch,
      palette.lightMutedSwatch,
      palette.dominantSwatch
    ).filterNotNull()

    if (swatches.isEmpty()) {
      return Pair(0xFF000000.toInt(), 0xFF000000.toInt())
    }

    val totalPopulation = swatches.sumOf { it.population }.coerceAtLeast(1)
    val primary = swatches.maxBy { swatch ->
      val hsl = FloatArray(3)
      ColorUtils.colorToHSL(swatch.rgb, hsl)
      val lumaScore = 1f - (kotlin.math.abs(hsl[2] - 0.52f) / 0.52f).coerceIn(0f, 1f)
      val satScore = 1f - (kotlin.math.abs(hsl[1] - 0.55f) / 0.55f).coerceIn(0f, 1f)
      val popScore = swatch.population.toFloat() / totalPopulation.toFloat()
      (popScore * 0.5f) + (lumaScore * 0.3f) + (satScore * 0.2f)
    }.rgb

    val primaryHsl = FloatArray(3)
    ColorUtils.colorToHSL(primary, primaryHsl)

    val secondaryCandidate = swatches
      .filter { it.rgb != primary }
      .map { swatch ->
        val hsl = FloatArray(3)
        ColorUtils.colorToHSL(swatch.rgb, hsl)
        val hueDiff = kotlin.math.min(
          kotlin.math.abs(hsl[0] - primaryHsl[0]),
          360f - kotlin.math.abs(hsl[0] - primaryHsl[0])
        )
        val lumaDiff = kotlin.math.abs(hsl[2] - primaryHsl[2])
        val satDiff = kotlin.math.abs(hsl[1] - primaryHsl[1])
        val score = (1f - (hueDiff / 60f).coerceIn(0f, 1f)) * 0.5f +
          (lumaDiff.coerceIn(0f, 1f) * 0.35f) +
          ((1f - satDiff).coerceIn(0f, 1f) * 0.15f)
        score to swatch.rgb
      }
      .filter { it.first > 0.35f }
      .maxByOrNull { it.first }
      ?.second

    val secondary = secondaryCandidate ?: run {
      val blendTarget = if (primaryHsl[2] > 0.55f) 0xFF000000.toInt() else 0xFFFFFFFF.toInt()
      ColorUtils.blendARGB(primary, blendTarget, 0.35f)
    }

    return Pair(primary, secondary)
  }
}
