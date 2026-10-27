package com.audiodock.app.lyrics

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.WindowManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 桌面歌词模块：管理一个 TYPE_APPLICATION_OVERLAY 悬浮窗，
 * 使用 application context 挂载（依赖前台服务保活进程）。
 */
class DesktopLyricsModule : Module() {

  private val mainHandler = Handler(Looper.getMainLooper())

  private var windowManager: WindowManager? = null
  private var floatView: FloatingLyricView? = null
  private var layoutParams: WindowManager.LayoutParams? = null

  override fun definition() = ModuleDefinition {
    Name("DesktopLyrics")

    Function("checkPermission") {
      val context = appContext.reactContext ?: return@Function false
      return@Function Settings.canDrawOverlays(context)
    }

    Function("requestPermission") {
      val activity = appContext.currentActivity
      val context = activity ?: appContext.reactContext ?: return@Function false
      try {
        val intent = Intent(
          Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
          Uri.parse("package:${context.packageName}")
        )
        if (activity == null) {
          intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
        return@Function true
      } catch (e: Exception) {
        return@Function false
      }
    }

    Function("show") {
      mainHandler.post { showOverlay() }
      return@Function true
    }

    Function("hide") {
      mainHandler.post { hideOverlay() }
      return@Function true
    }

    Function("isShowing") {
      return@Function floatView != null
    }

    Function("updateLyric") { line: String ->
      mainHandler.post {
        floatView?.lyricLine = line
      }
      return@Function true
    }

    Function("applyStyle") { fontSize: Double, textColor: String, strokeColor: String, strokeWidth: Double ->
      mainHandler.post {
        floatView?.let { view ->
          view.textSizeSp = fontSize.toFloat()
          view.textColor = parseColorSafe(textColor, Color.WHITE)
          view.strokeColor = parseColorSafe(strokeColor, Color.BLACK)
          view.strokeWidthDp = strokeWidth.toFloat()
        }
      }
      return@Function true
    }

    OnDestroy {
      mainHandler.post { hideOverlay() }
    }
  }

  private fun showOverlay() {
    val context = appContext.reactContext ?: return
    if (!Settings.canDrawOverlays(context)) return
    if (floatView != null) return

    val appContext = context.applicationContext
    val wm = appContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    windowManager = wm

    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
      x = 0
      y = 120
    }
    layoutParams = params

    val view = FloatingLyricView(appContext).apply {
      onDrag = { dx, dy ->
        layoutParams?.let { lp ->
          lp.x += dx.toInt()
          lp.y += dy.toInt()
          try {
            windowManager?.updateViewLayout(this, lp)
          } catch (e: Exception) {
            // view 可能已 detach，忽略
          }
        }
      }
      onSingleTap = {
        try {
          val launchIntent = appContext.packageManager.getLaunchIntentForPackage(appContext.packageName)
          launchIntent?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
          appContext.startActivity(launchIntent)
        } catch (e: Exception) {
          // 忽略
        }
      }
    }

    try {
      wm.addView(view, params)
      floatView = view
    } catch (e: Exception) {
      floatView = null
    }
  }

  private fun hideOverlay() {
    val view = floatView ?: return
    try {
      windowManager?.removeView(view)
    } catch (e: Exception) {
      // 已移除则忽略
    }
    floatView = null
    layoutParams = null
    windowManager = null
  }

  private fun parseColorSafe(color: String, fallback: Int): Int {
    return try {
      Color.parseColor(color)
    } catch (e: Exception) {
      fallback
    }
  }

  companion object {
    @Suppress("unused")
    private val API_LEVEL: Int = Build.VERSION.SDK_INT
  }
}
