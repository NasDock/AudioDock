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
import android.util.TypedValue
import android.view.Gravity
import android.view.WindowManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 桌面歌词模块：管理一个 TYPE_APPLICATION_OVERLAY 悬浮窗，
 * 使用 application context 挂载（依赖前台服务保活进程）。
 *
 * 交互：单击歌词 → 弹出全屏遮罩控制面板（样式设置 + 关闭歌词 + 打开应用）；
 * 点击遮罩空白处 → 收起面板。样式改动即时生效并持久化，同时发事件给 JS 同步应用内设置。
 */
class DesktopLyricsModule : Module() {

  private val mainHandler = Handler(Looper.getMainLooper())

  private var windowManager: WindowManager? = null
  private var floatView: FloatingLyricView? = null
  private var layoutParams: WindowManager.LayoutParams? = null

  private var panelView: LyricControlPanel? = null
  private var panelParams: WindowManager.LayoutParams? = null

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
      return@Function floatView != null
    }

    Function("updateLyric") { line: String ->
      mainHandler.post {
        floatView?.lyricLine = line
        panelView?.previewLine = line
      }
      return@Function true
    }

    Function("applyStyle") { fontSize: Double, textColor: String, strokeColor: String, strokeWidth: Double ->
      mainHandler.post {
        val style = LyricControlPanel.Style(
          fontSizeSp = fontSize.toFloat(),
          textColor = parseColorSafe(textColor, Color.WHITE),
          strokeColor = parseColorSafe(strokeColor, Color.BLACK),
          strokeWidthDp = strokeWidth.toFloat(),
        )
        floatView?.let { view -> applyStyleToView(view, style) }
        saveStyle(style)
      }
      return@Function true
    }

    OnDestroy {
      mainHandler.post { hideOverlay() }
    }
  }

  // ---------- 歌词悬浮窗 ----------

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
        // 注意：apply 块内 `layoutParams` 会解析到 View.getLayoutParams()（ViewGroup.LayoutParams，
        // 没有 x/y 字段），遮蔽模块属性，必须显式限定外层类
        this@DesktopLyricsModule.layoutParams?.let { lp ->
          lp.x += dx.toInt()
          lp.y += dy.toInt()
          try {
            windowManager?.updateViewLayout(this, lp)
          } catch (e: Exception) {
            // view 可能已 detach，忽略
          }
        }
      }
      // 单击歌词：切换遮罩控制面板
      onSingleTap = { togglePanel() }
    }
    // 先恢复上次样式（JS 侧 applyStyle 随后会再覆盖为应用内设置值）
    applyStyleToView(view, loadStyle())

    try {
      wm.addView(view, params)
      floatView = view
    } catch (e: Exception) {
      floatView = null
    }
  }

  private fun hideOverlay() {
    dismissPanel()
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

  // ---------- 遮罩控制面板 ----------

  private fun togglePanel() {
    if (panelView != null) {
      dismissPanel()
    } else {
      showPanel()
    }
  }

  private fun showPanel() {
    val context = appContext.reactContext?.applicationContext ?: return
    val wm = windowManager ?: return
    val lyricView = floatView ?: return
    if (!Settings.canDrawOverlays(context)) return
    if (panelView != null) return

    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = 0
      y = 0
    }
    panelParams = params

    val panel = LyricControlPanel(context)
    // 面板避开歌词：放在歌词下方 12dp
    val lyricBottom = (layoutParams?.y ?: 0) + lyricView.height
    panel.panelTopMarginPx = lyricBottom + dp(context, 12f).toInt()

    panel.onStyleChanged = { style ->
      floatView?.let { applyStyleToView(it, style) }
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
    panel.onCloseLyrics = {
      dismissPanel()
      hideOverlay()
      sendEvent("DesktopLyricsEvent", mapOf("action" to "closeRequested"))
    }
    panel.onOpenApp = {
      launchMainApp(context)
      dismissPanel()
    }
    panel.onDismiss = { dismissPanel() }

    panel.bindStyle(currentStyle(), lyricView.lyricLine)

    try {
      wm.addView(panel, params)
      panelView = panel
    } catch (e: Exception) {
      panelView = null
    }
  }

  private fun dismissPanel() {
    val panel = panelView ?: return
    try {
      windowManager?.removeView(panel)
    } catch (e: Exception) {
      // 已移除则忽略
    }
    panelView = null
    panelParams = null
  }

  private fun launchMainApp(context: Context) {
    try {
      val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
      launchIntent?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
      context.startActivity(launchIntent)
    } catch (e: Exception) {
      // 忽略
    }
  }

  // ---------- 样式应用与持久化 ----------

  private fun currentStyle(): LyricControlPanel.Style {
    val view = floatView
    return if (view != null) {
      LyricControlPanel.Style(view.textSizeSp, view.textColor, view.strokeColor, view.strokeWidthDp)
    } else {
      loadStyle()
    }
  }

  private fun applyStyleToView(view: FloatingLyricView, style: LyricControlPanel.Style) {
    view.textSizeSp = style.fontSizeSp
    view.textColor = style.textColor
    view.strokeColor = style.strokeColor
    view.strokeWidthDp = style.strokeWidthDp
  }

  private fun loadStyle(): LyricControlPanel.Style {
    val p = prefs
    return if (p == null) {
      LyricControlPanel.Style(18f, Color.WHITE, Color.BLACK, 2f)
    } else {
      LyricControlPanel.Style(
        fontSizeSp = p.getFloat(KEY_FONT_SIZE, 18f),
        textColor = p.getInt(KEY_TEXT_COLOR, Color.WHITE),
        strokeColor = p.getInt(KEY_STROKE_COLOR, Color.BLACK),
        strokeWidthDp = p.getFloat(KEY_STROKE_WIDTH, 2f),
      )
    }
  }

  private fun saveStyle(style: LyricControlPanel.Style) {
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
    TypedValue.applyDimension(
      TypedValue.COMPLEX_UNIT_DIP, value, context.resources.displayMetrics
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
