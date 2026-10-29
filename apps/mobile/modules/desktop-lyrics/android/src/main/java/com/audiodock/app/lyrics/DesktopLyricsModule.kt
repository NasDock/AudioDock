package com.audiodock.app.lyrics

import android.content.Context
import android.content.ComponentCallbacks2
import android.content.Intent
import android.content.SharedPreferences
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.PixelFormat
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
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
 * - 暂停播放时延迟隐藏悬浮窗（仅 GONE 不销毁，位置/歌词保留），恢复播放时立即重新显示
 */
class DesktopLyricsModule : Module() {

  private val mainHandler = Handler(Looper.getMainLooper())

  private var windowManager: WindowManager? = null
  private var windowView: DesktopLyricWindowView? = null
  private var layoutParams: WindowManager.LayoutParams? = null
  private var configCallback: ComponentCallbacks2? = null

  /** 暂停后延迟隐藏悬浮窗的任务（容忍切歌缓冲的短暂非播放态，避免窗口闪烁） */
  private val autoHideRunnable = Runnable { setOverlayVisible(false) }

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
        val view = windowView
        view?.lyricView?.lyricLine = line
        // 折叠态下同步量出新歌词宽度，一次性 updateViewLayout 原子改窗口宽度：
        // WRAP_CONTENT 的异步 relayout 会先把宽 buffer 画在旧窗口位置上，
        // 视觉上表现为长歌词「从右边滑入」，这里显式定宽消除该中间帧。
        // 窗口 gravity 为 CENTER_HORIZONTAL，宽度变化时中心保持不动。
        if (view != null && !view.isExpanded) {
          layoutParams?.let { lp ->
            lp.width = view.lyricView.desiredWidthPx()
            try {
              windowManager?.updateViewLayout(view, lp)
            } catch (e: Exception) {
              // view 可能已 detach，忽略
            }
          }
        }
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

    /**
     * JS 侧回推播放状态：
     * - 切换控制栏播放/暂停图标
     * - 暂停时延迟隐藏悬浮窗（仅置 GONE，不销毁窗口，拖动位置与歌词内容保留）；
     *   恢复播放时取消待执行的隐藏并立即重新显示。
     *   JS 侧仅在桌面歌词开关开启时调用本方法，故恢复显示天然受开关状态约束。
     */
    Function("updatePlaybackState") { playing: Boolean ->
      mainHandler.post {
        windowView?.setPlaying(playing)
        mainHandler.removeCallbacks(autoHideRunnable)
        if (playing) {
          setOverlayVisible(true)
        } else if (windowView != null) {
          mainHandler.postDelayed(autoHideRunnable, AUTO_HIDE_DELAY_MS)
        }
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

    // 展开态宽度动态读取当前屏幕宽度（折叠屏开合后 displayMetrics 会更新）
    val expandedWidth = {
      appContext.resources.displayMetrics.widthPixels - dp(appContext, 32f).toInt()
    }

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
          expandedWidth()
        } else {
          // 折叠态也用同步量宽（而非 WRAP_CONTENT），与 updateLyric 保持一致
          view.lyricView.desiredWidthPx()
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
      // 监听屏幕配置变化（折叠屏开合、旋转）：动态调整窗口宽度并触发重测量，
      // 避免折叠后悬浮窗仍保持展开态宽度而超出屏幕边界
      val callback = object : ComponentCallbacks2 {
        override fun onConfigurationChanged(newConfig: Configuration) {
          mainHandler.post {
            val v = windowView ?: return@post
            val lp = layoutParams ?: return@post
            // 折叠屏开合/旋转后 displayMetrics 更新，两种状态都按最新屏宽同步量宽，
            // 避免折叠后悬浮窗仍保持旧宽度而超出屏幕边界
            lp.width = if (v.isExpanded) {
              expandedWidth()
            } else {
              v.lyricView.desiredWidthPx()
            }
            try {
              windowManager?.updateViewLayout(v, lp)
            } catch (e: Exception) {
              // 忽略
            }
            v.requestLayout()
          }
        }

        @Deprecated("ComponentCallbacks2 接口要求实现")
        override fun onTrimMemory(level: Int) {}
      }
      appContext.registerComponentCallbacks(callback)
      configCallback = callback
    } catch (e: Exception) {
      windowView = null
    }
  }

  private fun hideOverlay() {
    mainHandler.removeCallbacks(autoHideRunnable)
    val view = windowView ?: return
    configCallback?.let {
      try {
        appContext.reactContext?.applicationContext?.unregisterComponentCallbacks(it)
      } catch (e: Exception) {
        // 忽略
      }
    }
    configCallback = null
    try {
      windowManager?.removeView(view)
    } catch (e: Exception) {
      // 已移除则忽略
    }
    windowView = null
    layoutParams = null
    windowManager = null
  }

  /**
   * 仅切换悬浮窗可见性，不销毁窗口：
   * 暂停隐藏时保留拖动位置、展开状态与歌词内容，恢复播放时原样显示。
   * 根视图 GONE 后 WRAP_CONTENT 窗口收缩为 0 尺寸，不会拦截触摸。
   */
  private fun setOverlayVisible(visible: Boolean) {
    val view = windowView ?: return
    view.visibility = if (visible) View.VISIBLE else View.GONE
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
    /** 暂停后延迟隐藏悬浮窗的时间（毫秒），短于此时长的非播放态（如切歌缓冲）不触发隐藏 */
    private const val AUTO_HIDE_DELAY_MS = 1000L
  }
}
