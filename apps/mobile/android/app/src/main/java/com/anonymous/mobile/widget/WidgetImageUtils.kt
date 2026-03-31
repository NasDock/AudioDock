package com.anonymous.mobile.widget

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.Shader
import androidx.core.graphics.ColorUtils

internal object WidgetImageUtils {
  fun decodeSampledBitmap(
    path: String,
    reqWidth: Int,
    reqHeight: Int
  ): Bitmap? {
    if (path.isBlank() || reqWidth <= 0 || reqHeight <= 0) return null

    val bounds = BitmapFactory.Options().apply {
      inJustDecodeBounds = true
    }
    BitmapFactory.decodeFile(path, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

    val options = BitmapFactory.Options().apply {
      inSampleSize = calculateInSampleSize(bounds, reqWidth, reqHeight)
      inPreferredConfig = Bitmap.Config.ARGB_8888
    }
    return BitmapFactory.decodeFile(path, options)
  }

  fun themedGradientBackground(
    targetWidth: Int,
    targetHeight: Int,
    primaryColor: Int,
    secondaryColor: Int
  ): Bitmap? {
    if (targetWidth <= 0 || targetHeight <= 0) return null

    val startColor = normalizeGradientColor(primaryColor, darken = 0.08f)
    val endColor = normalizeGradientColor(resolveNearbyColor(primaryColor, secondaryColor), darken = 0.2f)

    val bitmap = Bitmap.createBitmap(targetWidth, targetHeight, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    paint.shader = LinearGradient(
      0f,
      0f,
      targetWidth.toFloat(),
      targetHeight.toFloat(),
      startColor,
      endColor,
      Shader.TileMode.CLAMP
    )
    canvas.drawRect(Rect(0, 0, targetWidth, targetHeight), paint)

    val overlay = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.argb(42, 255, 255, 255)
    }
    canvas.drawRect(0f, 0f, targetWidth.toFloat(), targetHeight * 0.45f, overlay)
    return bitmap
  }

  private fun resolveNearbyColor(primaryColor: Int, secondaryColor: Int): Int {
    if (secondaryColor != Color.BLACK || primaryColor != Color.BLACK) {
      val primaryHsl = FloatArray(3)
      val secondaryHsl = FloatArray(3)
      ColorUtils.colorToHSL(primaryColor, primaryHsl)
      ColorUtils.colorToHSL(secondaryColor, secondaryHsl)
      val hueDiff = kotlin.math.min(
        kotlin.math.abs(primaryHsl[0] - secondaryHsl[0]),
        360f - kotlin.math.abs(primaryHsl[0] - secondaryHsl[0])
      )
      if (hueDiff <= 28f) {
        return secondaryColor
      }
    }

    val hsl = FloatArray(3)
    ColorUtils.colorToHSL(primaryColor, hsl)
    hsl[1] = (hsl[1] * 0.82f).coerceIn(0f, 1f)
    hsl[2] = (hsl[2] + if (hsl[2] < 0.45f) 0.12f else -0.12f).coerceIn(0.18f, 0.82f)
    return ColorUtils.HSLToColor(hsl)
  }

  private fun normalizeGradientColor(color: Int, darken: Float): Int {
    val hsl = FloatArray(3)
    ColorUtils.colorToHSL(color, hsl)
    hsl[1] = hsl[1].coerceIn(0.2f, 0.85f)
    hsl[2] = (hsl[2] - darken).coerceIn(0.18f, 0.72f)
    return ColorUtils.HSLToColor(hsl)
  }

  private fun calculateInSampleSize(
    options: BitmapFactory.Options,
    reqWidth: Int,
    reqHeight: Int
  ): Int {
    val height = options.outHeight
    val width = options.outWidth
    var inSampleSize = 1

    if (height > reqHeight || width > reqWidth) {
      var halfHeight = height / 2
      var halfWidth = width / 2

      while (halfHeight / inSampleSize >= reqHeight && halfWidth / inSampleSize >= reqWidth) {
        inSampleSize *= 2
      }
    }

    return inSampleSize.coerceAtLeast(1)
  }
}
