package com.audiodock.app.lyrics

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import java.util.Locale

/**
 * 桌面歌词一体式悬浮窗内容 View（参考网易云/鸿蒙系统歌词交互）：
 *
 * 折叠态（默认）：仅一行歌词，透明背景，可拖动。
 * 展开态（单击歌词）：整个悬浮窗变为半透明圆角面板——
 *   - 顶部：歌词行 + 右上角 ✕ 关闭
 *   - 控制栏：锁定 / 上一首 / 播放暂停 / 下一首 / 设置
 *   - 设置区（点齿轮展开）：文字颜色色板、描边颜色色板、字号步进、描边宽度步进
 * 再次单击歌词 / 点击 ✕ 以外区域无操作 6 秒 → 自动收起为纯歌词。
 *
 * 窗口尺寸由模块侧管理（展开时宽度≈屏宽-32dp，折叠时 WRAP_CONTENT）。
 */
class DesktopLyricWindowView(context: Context) : LinearLayout(context) {

  data class Style(
    var fontSizeSp: Float,
    var textColor: Int,
    var strokeColor: Int,
    var strokeWidthDp: Float,
  )

  /** 歌词绘制 View（拖动/单击手势挂在它上面，由模块侧接线） */
  val lyricView: FloatingLyricView

  var style: Style = Style(18f, Color.WHITE, Color.BLACK, 2f)
    private set

  var isExpanded: Boolean = false
    private set
  var isLocked: Boolean = false
    private set
  private var settingsExpanded = false
  private var playing = false

  // ---------- 对外回调（模块侧接线） ----------
  var onClose: (() -> Unit)? = null
  var onPrev: (() -> Unit)? = null
  var onNext: (() -> Unit)? = null
  var onTogglePlay: (() -> Unit)? = null
  var onStyleChanged: ((Style) -> Unit)? = null
  /** 展开/收起后需要模块侧 updateViewLayout 调整窗口宽度 */
  var onLayoutChanged: (() -> Unit)? = null

  private val handler = Handler(Looper.getMainLooper())
  private val autoCollapseRunnable = Runnable { setExpanded(false) }

  private val isZh = Locale.getDefault().language.startsWith("zh")

  private lateinit var closeButton: TextView
  private lateinit var controlBar: LinearLayout
  private lateinit var settingsPanel: LinearLayout
  private lateinit var lockIcon: LyricIconView
  private lateinit var playPauseIcon: LyricIconView
  private lateinit var fontSizeValue: TextView
  private lateinit var strokeWidthValue: TextView
  private val textSwatches = mutableListOf<Pair<View, Int>>()
  private val strokeSwatches = mutableListOf<Pair<View, Int>>()

  companion object {
    private val TEXT_COLORS = intArrayOf(
      0xFFFFFFFF.toInt(), 0xFFFFD700.toInt(), 0xFFFF6B6B.toInt(), 0xFF4ECDC4.toInt(),
      0xFF45B7D1.toInt(), 0xFF96CEB4.toInt(), 0xFFF38181.toInt(), 0xFFAA96DA.toInt(),
    )
    private val STROKE_COLORS = intArrayOf(
      0xFF000000.toInt(), 0xFFFFFFFF.toInt(), 0xFF333333.toInt(),
      0xFF8B0000.toInt(), 0xFF1E3A5F.toInt(), 0xFF4A148C.toInt(),
    )

    private const val FONT_SIZE_MIN = 12f
    private const val FONT_SIZE_MAX = 36f
    private const val FONT_SIZE_STEP = 2f
    private const val STROKE_MIN = 0f
    private const val STROKE_MAX = 8f
    private const val STROKE_STEP = 1f

    private const val PANEL_BG = 0xB31C1C1E.toInt()
    private const val LABEL_COLOR = 0x99FFFFFF.toInt()
    private const val AUTO_COLLAPSE_MS = 6000L
  }

  init {
    orientation = VERTICAL
    val padH = dp(14f).toInt()
    setPadding(padH, dp(6f).toInt(), padH, dp(6f).toInt())

    // ---------- 顶部：歌词 + ✕ ----------
    val header = FrameLayout(context)
    lyricView = FloatingLyricView(context)
    header.addView(
      lyricView,
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.WRAP_CONTENT,
      ),
    )
    closeButton = TextView(context).apply {
      text = "✕"
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
      gravity = Gravity.CENTER
      visibility = GONE
      setOnClickListener {
        onClose?.invoke()
      }
    }
    val closeSize = dp(32f).toInt()
    header.addView(
      closeButton,
      FrameLayout.LayoutParams(closeSize, closeSize, Gravity.TOP or Gravity.END),
    )
    addView(
      header,
      LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT),
    )

    // ---------- 控制栏 ----------
    controlBar = LinearLayout(context).apply {
      orientation = HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      visibility = GONE
    }
    lockIcon = addIconButton(controlBar, LyricIconView.Icon.UNLOCK) {
      toggleLock()
    }
    lockIcon.iconAlpha = 0.65f
    addIconButton(controlBar, LyricIconView.Icon.PREV) { onPrev?.invoke() }
    playPauseIcon = addIconButton(controlBar, LyricIconView.Icon.PLAY) { onTogglePlay?.invoke() }
    addIconButton(controlBar, LyricIconView.Icon.NEXT) { onNext?.invoke() }
    addTextButton(controlBar, "⚙") {
      settingsExpanded = !settingsExpanded
      settingsPanel.visibility = if (settingsExpanded) VISIBLE else GONE
      refreshAutoCollapse()
      onLayoutChanged?.invoke()
    }
    addView(
      controlBar,
      LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT).apply {
        topMargin = dp(4f).toInt()
      },
    )

    // ---------- 设置区 ----------
    settingsPanel = LinearLayout(context).apply {
      orientation = VERTICAL
      visibility = GONE
    }
    buildColorRow(if (isZh) "文字" else "Text", TEXT_COLORS, textSwatches) { color ->
      style.textColor = color
      refreshStyleUI()
      emitStyleChanged()
    }
    buildColorRow(if (isZh) "描边" else "Stroke", STROKE_COLORS, strokeSwatches) { color ->
      style.strokeColor = color
      refreshStyleUI()
      emitStyleChanged()
    }
    buildStepperRow()
    addView(
      settingsPanel,
      LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT),
    )
  }

  // ---------- 展开 / 收起 ----------

  fun toggleExpanded() = setExpanded(!isExpanded)

  fun setExpanded(expanded: Boolean) {
    if (isExpanded == expanded) return
    isExpanded = expanded
    if (!expanded) settingsExpanded = false
    background = if (expanded) {
      GradientDrawable().apply {
        setColor(PANEL_BG)
        cornerRadius = dp(14f)
      }
    } else {
      null
    }
    closeButton.visibility = if (expanded) VISIBLE else GONE
    controlBar.visibility = if (expanded) VISIBLE else GONE
    settingsPanel.visibility = if (expanded && settingsExpanded) VISIBLE else GONE
    refreshAutoCollapse()
    onLayoutChanged?.invoke()
  }

  /** 展开后 6 秒无操作自动收起；任何面板交互会重置计时 */
  private fun refreshAutoCollapse() {
    handler.removeCallbacks(autoCollapseRunnable)
    if (isExpanded) {
      handler.postDelayed(autoCollapseRunnable, AUTO_COLLAPSE_MS)
    }
  }

  // ---------- 状态注入 ----------

  fun setPlaying(value: Boolean) {
    if (playing == value) return
    playing = value
    playPauseIcon.icon = if (value) LyricIconView.Icon.PAUSE else LyricIconView.Icon.PLAY
  }

  private fun toggleLock() {
    isLocked = !isLocked
    lockIcon.icon = if (isLocked) LyricIconView.Icon.LOCK else LyricIconView.Icon.UNLOCK
    lockIcon.iconAlpha = if (isLocked) 1f else 0.65f
    refreshAutoCollapse()
  }

  /** 模块侧注入样式（启动恢复 / JS 下发） */
  fun bindStyle(newStyle: Style) {
    style = newStyle.copy()
    applyStyleToLyric()
    refreshStyleUI()
  }

  fun currentStyle(): Style = style.copy()

  private fun applyStyleToLyric() {
    lyricView.textSizeSp = style.fontSizeSp
    lyricView.textColor = style.textColor
    lyricView.strokeColor = style.strokeColor
    lyricView.strokeWidthDp = style.strokeWidthDp
  }

  // ---------- 设置区构建 ----------

  private fun buildColorRow(
    label: String,
    colors: IntArray,
    swatches: MutableList<Pair<View, Int>>,
    onPick: (Int) -> Unit,
  ) {
    val row = LinearLayout(context).apply {
      orientation = HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
    }
    row.addView(makeLabel(label))

    colors.forEach { color ->
      val swatch = View(context)
      val size = dp(24f).toInt()
      val lp = LayoutParams(size, size).apply {
        marginStart = dp(6f).toInt()
      }
      swatch.background = swatchDrawable(color, selected = false)
      swatch.setOnClickListener {
        onPick(color)
        refreshAutoCollapse()
      }
      swatches.add(swatch to color)
      row.addView(swatch, lp)
    }
    settingsPanel.addView(
      row,
      LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT).apply {
        topMargin = dp(8f).toInt()
      },
    )
  }

  private fun buildStepperRow() {
    val row = LinearLayout(context).apply {
      orientation = HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
    }
    // 字号组
    row.addView(makeLabel(if (isZh) "字号" else "Size"))
    row.addView(makeStepperButton("−") { adjustFontSize(-FONT_SIZE_STEP) })
    fontSizeValue = makeValueText()
    row.addView(fontSizeValue)
    row.addView(makeStepperButton("＋") { adjustFontSize(FONT_SIZE_STEP) })
    // 描边宽度组
    row.addView(
      makeLabel(if (isZh) "描边" else "Width"),
      LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT).apply {
        marginStart = dp(14f).toInt()
      },
    )
    row.addView(makeStepperButton("−") { adjustStrokeWidth(-STROKE_STEP) })
    strokeWidthValue = makeValueText()
    row.addView(strokeWidthValue)
    row.addView(makeStepperButton("＋") { adjustStrokeWidth(STROKE_STEP) })

    settingsPanel.addView(
      row,
      LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT).apply {
        topMargin = dp(10f).toInt()
      },
    )
  }

  private fun makeLabel(text: String): TextView = TextView(context).apply {
    this.text = text
    setTextColor(LABEL_COLOR)
    setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
  }

  private fun makeValueText(): TextView = TextView(context).apply {
    setTextColor(Color.WHITE)
    setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
    gravity = Gravity.CENTER
    minWidth = dp(32f).toInt()
  }

  private fun makeStepperButton(text: String, onClick: () -> Unit): TextView =
    TextView(context).apply {
      this.text = text
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
      gravity = Gravity.CENTER
      background = GradientDrawable().apply {
        setColor(0x33FFFFFF)
        cornerRadius = dp(7f)
      }
      val size = dp(28f).toInt()
      layoutParams = LayoutParams(size, size).apply {
        marginStart = dp(6f).toInt()
      }
      setOnClickListener {
        onClick()
        refreshAutoCollapse()
      }
    }

  private fun swatchDrawable(color: Int, selected: Boolean): GradientDrawable =
    GradientDrawable().apply {
      shape = GradientDrawable.OVAL
      setColor(color)
      if (selected) {
        setStroke(dp(2f).toInt(), Color.WHITE)
      } else {
        setStroke(dp(1f).toInt(), 0x44FFFFFF)
      }
    }

  private fun adjustFontSize(delta: Float) {
    val next = (style.fontSizeSp + delta).coerceIn(FONT_SIZE_MIN, FONT_SIZE_MAX)
    if (next == style.fontSizeSp) return
    style.fontSizeSp = next
    applyStyleToLyric()
    refreshStyleUI()
    emitStyleChanged()
  }

  private fun adjustStrokeWidth(delta: Float) {
    val next = (style.strokeWidthDp + delta).coerceIn(STROKE_MIN, STROKE_MAX)
    if (next == style.strokeWidthDp) return
    style.strokeWidthDp = next
    applyStyleToLyric()
    refreshStyleUI()
    emitStyleChanged()
  }

  private fun refreshStyleUI() {
    fontSizeValue.text = style.fontSizeSp.toInt().toString()
    strokeWidthValue.text = String.format(Locale.US, "%.0f", style.strokeWidthDp)
    textSwatches.forEach { (view, color) ->
      view.background = swatchDrawable(color, color == style.textColor)
    }
    strokeSwatches.forEach { (view, color) ->
      view.background = swatchDrawable(color, color == style.strokeColor)
    }
  }

  private fun emitStyleChanged() {
    onStyleChanged?.invoke(style.copy())
  }

  // ---------- 控制栏按钮工厂 ----------

  private fun addIconButton(
    bar: LinearLayout,
    icon: LyricIconView.Icon,
    onClick: () -> Unit,
  ): LyricIconView {
    val iconView = LyricIconView(context).apply { this.icon = icon }
    val container = FrameLayout(context).apply {
      setOnClickListener {
        onClick()
        refreshAutoCollapse()
      }
      // 无边水波纹反馈
      val attrs = intArrayOf(android.R.attr.selectableItemBackgroundBorderless)
      val ta = context.obtainStyledAttributes(attrs)
      val ripple = ta.getDrawable(0)
      ta.recycle()
      foreground = ripple
    }
    val size = dp(22f).toInt()
    container.addView(
      iconView,
      FrameLayout.LayoutParams(size, size, Gravity.CENTER),
    )
    bar.addView(
      container,
      LayoutParams(0, dp(44f).toInt(), 1f),
    )
    return iconView
  }

  private fun addTextButton(bar: LinearLayout, text: String, onClick: () -> Unit): TextView {
    val btn = TextView(context).apply {
      this.text = text
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 19f)
      gravity = Gravity.CENTER
      setOnClickListener { onClick() }
      val attrs = intArrayOf(android.R.attr.selectableItemBackgroundBorderless)
      val ta = context.obtainStyledAttributes(attrs)
      val ripple = ta.getDrawable(0)
      ta.recycle()
      foreground = ripple
    }
    bar.addView(btn, LayoutParams(0, dp(44f).toInt(), 1f))
    return btn
  }

  /** 视图从窗口移除时清理定时器 */
  override fun onDetachedFromWindow() {
    handler.removeCallbacks(autoCollapseRunnable)
    super.onDetachedFromWindow()
  }

  private fun dp(value: Float): Float =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, resources.displayMetrics)
}
