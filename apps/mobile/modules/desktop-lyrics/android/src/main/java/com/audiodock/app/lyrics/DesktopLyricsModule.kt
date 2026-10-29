package com.audiodock.app.lyrics

import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Color
import android.graphics.PixelFormat
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.WindowManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 桌面歌词模块：管理单个 TYPE_APPLICATION_OVERLAY 悬浮窗（歌词 + 控制面板一体），
 * 使用 application context 挂载（依赖前台服务保活进程）。
 *
 * 交互（参考网易云/鸿蒙系统歌词）：
 * - 单击歌词 → 展开/收起内联控制栏（锁、上一首、播放暂停、下一首、设置）
 * - 设置齿轮 → 展开样式区（文字颜色、描边颜色、字号、描边宽度），改动即时生效
 * - ✕ → 关闭桌面歌词（发事件给 JS 联动设置页开关）
 * - 播放控制按钮 → 发事件给 JS 执行实际播放操作；JS 侧通过 updatePlaybackState 回推播放状态
 * - 展开后 6 秒无操作自动收起为纯歌词
 */
class DesktopLyricsModule : Module() {

  private val mainHandler = Handler(Looper.getMainLooper())

  private var windowManager: WindowManager? = null
  private var windowView: DesktopLyricWindowView? = null
  private var layoutParams: WindowManager.LayoutParams? = null

  private val prefs: SharedPreferences?
    get() = appContext.reactContext?.applicationContext
      ?.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  override fun definition() = ModuleDefinition {
    Name("DesktopLyrics")

    Events("DesktopLyricsEvent")

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
      return@Function windowView != null
    }

    Function("updateLyric") { line: String ->
      mainHandler.post {
        windowView?.lyricView?.lyricLine = line
      }
      return@Function true
    }

    Function("applyStyle") { fontSize: Double, textColor: String, strokeColor: String, strokeWidth: Double ->
      mainHandler.post {
        val style = DesktopLyricWindowView.Style(
          fontSizeSp = fontSize.toFloat(),
          textColor = parseColorSafe(textColor, Color.WHITE),
          strokeColor = parseColorSafe(strokeColor, Color.BLACK),
          strokeWidthDp = strokeWidth.toFloat(),
        )
        windowView?.bindStyle(style)
        saveStyle(style)
      }
      return@Function true
    }

    /** JS 侧回推播放状态，用于切换播放/暂停图标 */
    Function("updatePlaybackState") { playing: Boolean ->
      mainHandler.post {
        windowView?.setPlaying(playing)
      }
      return@Function true
    }

    OnDestroy {
      mainHandler.post { hideOverlay() }
    }
  }

  // ---------- 悬浮窗管理 ----------

  private fun showOverlay() {
    val context = appContext.reactContext ?: return
    if (!Settings.canDrawOverlays(context)) return
    if (windowView != null) return

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

    val screenWidth = appContext.resources.displayMetrics.widthPixels
    val expandedWidth = screenWidth - dp(appContext, 32f).toInt()

    val view = DesktopLyricWindowView(appContext)

    // 拖动（锁定时禁用）；单击歌词切换控制栏
    view.lyricView.onDrag = { dx, dy ->
      if (!view.isLocked) {
        layoutParams?.let { lp ->
          lp.x += dx.toInt()
          lp.y += dy.toInt()
          try {
            windowManager?.updateViewLayout(view, lp)
          } catch (e: Exception) {
            // view 可能已 detach，忽略
          }
        }
      }
    }
    view.lyricView.onSingleTap = { view.toggleExpanded() }

    // 展开/收起后调整窗口宽度并触发重排
    view.onLayoutChanged = {
      layoutParams?.let { lp ->
        lp.width = if (view.isExpanded) {
          expandedWidth
        } else {
          WindowManager.LayoutParams.WRAP_CONTENT
        }
        try {
          windowManager?.updateViewLayout(view, lp)
        } catch (e: Exception) {
          // 忽略
        }
      }
    }

    // 面板回调
    view.onClose = {
      hideOverlay()
      sendEvent("DesktopLyricsEvent", mapOf("action" to "closeRequested"))
    }
    view.onPrev = { sendEvent("DesktopLyricsEvent", mapOf("action" to "prev")) }
    view.onNext = { sendEvent("DesktopLyricsEvent", mapOf("action" to "next")) }
    view.onTogglePlay = { sendEvent("DesktopLyricsEvent", mapOf("action" to "togglePlay")) }
    view.onStyleChanged = { style ->
      saveStyle(style)
      sendEvent(
        "DesktopLyricsEvent",
        mapOf(
          "action" to "styleChanged",
          "fontSize" to style.fontSizeSp.toDouble(),
          "textColor" to toHexColor(style.textColor),
          "strokeColor" to toHexColor(style.strokeColor),
          "strokeWidth" to style.strokeWidthDp.toDouble(),
        )
      )
    }

    // 先恢复上次样式（JS 侧 applyStyle 随后会再覆盖为应用内设置值）
    view.bindStyle(loadStyle())

    try {
      wm.addView(view, params)
      windowView = view
    } catch (e: Exception) {
      windowView = null
    }
  }

  private fun hideOverlay() {
    val view = windowView ?: return
    try {
      windowManager?.removeView(view)
    } catch (e: Exception) {
      // 已移除则忽略
    }
    windowView = null
    layoutParams = null
    windowManager = null
  }

  // ---------- 样式持久化 ----------

  private fun loadStyle(): DesktopLyricWindowView.Style {
    val p = prefs
    return if (p == null) {
      DesktopLyricWindowView.Style(18f, Color.WHITE, Color.BLACK, 2f)
    } else {
      DesktopLyricWindowView.Style(
        fontSizeSp = p.getFloat(KEY_FONT_SIZE, 18f),
        textColor = p.getInt(KEY_TEXT_COLOR, Color.WHITE),
        strokeColor = p.getInt(KEY_STROKE_COLOR, Color.BLACK),
        strokeWidthDp = p.getFloat(KEY_STROKE_WIDTH, 2f),
      )
    }
  }

  private fun saveStyle(style: DesktopLyricWindowView.Style) {
    prefs?.edit()
      ?.putFloat(KEY_FONT_SIZE, style.fontSizeSp)
      ?.putInt(KEY_TEXT_COLOR, style.textColor)
      ?.putInt(KEY_STROKE_COLOR, style.strokeColor)
      ?.putFloat(KEY_STROKE_WIDTH, style.strokeWidthDp)
      ?.apply()
  }

  private fun toHexColor(color: Int): String =
    String.format("#%06X", 0xFFFFFF and color)

  private fun dp(context: Context, value: Float): Float =
    android.util.TypedValue.applyDimension(
      android.util.TypedValue.COMPLEX_UNIT_DIP, value, context.resources.displayMetrics
    )

  private fun parseColorSafe(color: String, fallback: Int): Int {
    return try {
      Color.parseColor(color)
    } catch (e: Exception) {
      fallback
    }
  }

  companion object {
    private const val PREFS_NAME = "desktop_lyrics_prefs"
    private const val KEY_FONT_SIZE = "fontSize"
    private const val KEY_TEXT_COLOR = "textColor"
    private const val KEY_STROKE_COLOR = "strokeColor"
    private const val KEY_STROKE_WIDTH = "strokeWidth"
  }
}
