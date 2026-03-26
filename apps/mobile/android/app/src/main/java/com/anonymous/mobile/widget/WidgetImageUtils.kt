package com.anonymous.mobile.widget

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RenderEffect
import android.graphics.Shader
import android.os.Build

internal object WidgetImageUtils {
  fun blurredBackground(source: Bitmap, targetWidth: Int, targetHeight: Int): Bitmap? {
    if (targetWidth <= 0 || targetHeight <= 0) return null
    val cropped = centerCrop(source, targetWidth, targetHeight)
    val scale = 0.07f
    val downW = (targetWidth * scale).toInt().coerceAtLeast(1)
    val downH = (targetHeight * scale).toInt().coerceAtLeast(1)
    val down = Bitmap.createScaledBitmap(cropped, downW, downH, true)
    val blurred = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      blurBitmap(down, 18f)
    } else {
      down
    }
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

  private fun blurBitmap(source: Bitmap, radius: Float): Bitmap {
    val output = Bitmap.createBitmap(source.width, source.height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(output)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    paint.renderEffect = RenderEffect.createBlurEffect(radius, radius, Shader.TileMode.CLAMP)
    canvas.drawBitmap(source, 0f, 0f, paint)
    return output
  }
}
