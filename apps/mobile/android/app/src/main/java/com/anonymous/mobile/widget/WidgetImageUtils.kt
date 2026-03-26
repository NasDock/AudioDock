package com.anonymous.mobile.widget

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Shader
import android.os.Build

internal object WidgetImageUtils {
  fun blurredBackground(source: Bitmap, targetWidth: Int, targetHeight: Int): Bitmap? {
    if (targetWidth <= 0 || targetHeight <= 0) return null
    val cropped = centerCrop(source, targetWidth, targetHeight)
    val scale = 0.08f
    val downW = (targetWidth * scale).toInt().coerceAtLeast(1)
    val downH = (targetHeight * scale).toInt().coerceAtLeast(1)
    val down = Bitmap.createScaledBitmap(cropped, downW, downH, true)
    
    val blurred = fastBlur(down, 6)
    return Bitmap.createScaledBitmap(blurred, targetWidth, targetHeight, true)
  }

  private fun centerCrop(source: Bitmap, targetWidth: Int, targetHeight: Int): Bitmap {
    val srcW = source.width
    val srcH = source.height
    if (srcW <= 0 || srcH <= 0) return source
    val targetRatio = targetWidth.toFloat() / targetHeight.toFloat()
    val srcRatio = srcW.toFloat() / srcH.toFloat()
    return if (srcRatio > targetRatio) {
      val newW = (srcH * targetRatio).toInt().coerceAtMost(srcW)
      val x = ((srcW - newW) / 2f).toInt().coerceAtLeast(0)
      Bitmap.createBitmap(source, x, 0, newW, srcH)
    } else {
      val newH = (srcW / targetRatio).toInt().coerceAtMost(srcH)
      val y = ((srcH - newH) / 2f).toInt().coerceAtLeast(0)
      Bitmap.createBitmap(source, 0, y, srcW, newH)
    }
  }

  // Fast Box Blur implementation
  private fun fastBlur(source: Bitmap, radius: Int): Bitmap {
    val bitmap = source.copy(source.config ?: Bitmap.Config.ARGB_8888, true)
    if (radius < 1) return bitmap
    val w = bitmap.width
    val h = bitmap.height
    val pixels = IntArray(w * h)
    bitmap.getPixels(pixels, 0, w, 0, 0, w, h)
    val result = IntArray(w * h)

    // Horizontal pass
    for (y in 0 until h) {
      for (x in 0 until w) {
        var r = 0; var g = 0; var b = 0; var a = 0; var count = 0
        for (dx in -radius..radius) {
          val nx = x + dx
          if (nx in 0 until w) {
            val color = pixels[y * w + nx]
            a += (color shr 24) and 0xFF
            r += (color shr 16) and 0xFF
            g += (color shr 8) and 0xFF
            b += color and 0xFF
            count++
          }
        }
        result[y * w + x] = ((a / count) shl 24) or ((r / count) shl 16) or ((g / count) shl 8) or (b / count)
      }
    }

    // Vertical pass
    val finalResult = IntArray(w * h)
    for (x in 0 until w) {
      for (y in 0 until h) {
        var r = 0; var g = 0; var b = 0; var a = 0; var count = 0
        for (dy in -radius..radius) {
          val ny = y + dy
          if (ny in 0 until h) {
            val color = result[ny * w + x]
            a += (color shr 24) and 0xFF
            r += (color shr 16) and 0xFF
            g += (color shr 8) and 0xFF
            b += color and 0xFF
            count++
          }
        }
        finalResult[y * w + x] = ((a / count) shl 24) or ((r / count) shl 16) or ((g / count) shl 8) or (b / count)
      }
    }

    bitmap.setPixels(finalResult, 0, w, 0, 0, w, h)
    return bitmap
  }
}
