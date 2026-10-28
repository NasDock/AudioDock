package com.audiodock.app.lyrics

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import java.util.Locale

/**
 * 桌面歌词控制遮罩层（全屏 Window 的内容 View）：
 * - 半透明暗色遮罩，点击空白区域 dismiss
 * - 控制面板：歌词预览、字号 +/-、文字颜色色板、描边颜色色板、描边宽度 +/-、
 *   「打开应用」「关闭歌词」按钮
 * - 样式调整通过 onStyleChanged 回调实时生效（模块侧同步到歌词 View / 持久化 / JS）
 */
class LyricControlPanel(context: Context) : FrameLayout(context) {

  data class Style(
    var fontSizeSp: Float,
    var textColor: Int,
    var strokeColor: Int,
    var strokeWidthDp: Float,
  )

  /** 当前样式（模块侧在打开面板前注入） */
  var style: Style = Style(18f, Color.WHITE, Color.BLACK, 2f)

  /** 面板预览歌词行（模块侧注入当前歌词） */
  var previewLine: String = ""
    set(value) {
      field = value
      previewView.lyricLine = value
    }

  /** 面板顶部偏移（避开歌词位置），单位 px */
  var panelTopMarginPx: Int = 0
    set(value) {
      field = value
      (panel.layoutParams as? MarginLayoutParams)?.topMargin = value
      panel.requestLayout()
    }

  var onStyleChanged: ((Style) -> Unit)? = null
  var onCloseLyrics: (() -> Unit)? = null
  var onOpenApp: (() -> Unit)? = null
  var onDismiss: (() -> Unit)? = null

  private val isZh = Locale.getDefault().language.startsWith("zh")

  private lateinit var panel: LinearLayout
  private lateinit var previewView: FloatingLyricView
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

    private const val PANEL_BG = 0xF21C1C1E.toInt()
    private const val DIM_COLOR = 0x66000000
    private const val LABEL_COLOR = 0xCCFFFFFF.toInt()
    private const val BTN_BG = 0x33FFFFFF
    private const val CLOSE_BTN_COLOR = 0xFFFF6B6B.toInt()
  }

  init {
    // 全屏遮罩：点击空白处 dismiss
    setBackgroundColor(DIM_COLOR)
    setOnClickListener { onDismiss?.invoke() }

    panel = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      background = GradientDrawable().apply {
        setColor(PANEL_BG)
        cornerRadius = dp(16f)
      }
      setPadding(dp(16f).toInt(), dp(16f).toInt(), dp(16f).toInt(), dp(16f).toInt())
      // 拦截点击，避免触发遮罩 dismiss
      setOnClickListener { }
    }

    val panelLp = LayoutParams(
      LayoutParams.MATCH_PARENT,
      LayoutParams.WRAP_CONTENT,
      Gravity.TOP or Gravity.CENTER_HORIZONTAL,
    ).apply {
      leftMargin = dp(20f).toInt()
      rightMargin = dp(20f).toInt()
      topMargin = panelTopMarginPx
    }
    addView(panel, panelLp)

    buildPreview()
    buildStepperRow(
      label = if (isZh) "字号" else "Font Size",
      valueView = { fontSizeValue = it },
      onMinus = { adjustFontSize(-FONT_SIZE_STEP) },
      onPlus = { adjustFontSize(FONT_SIZE_STEP) },
    )
    buildColorRow(if (isZh) "文字颜色" else "Text Color", TEXT_COLORS, textSwatches) { color ->
      style.textColor = color
      refreshStyleUI()
      emitStyleChanged()
    }
    buildColorRow(if (isZh) "描边颜色" else "Stroke Color", STROKE_COLORS, strokeSwatches) { color ->
      style.strokeColor = color
      refreshStyleUI()
      emitStyleChanged()
    }
    buildStepperRow(
      label = if (isZh) "描边宽度" else "Stroke Width",
      valueView = { strokeWidthValue = it },
      onMinus = { adjustStrokeWidth(-STROKE_STEP) },
      onPlus = { adjustStrokeWidth(STROKE_STEP) },
    )
    buildActionRow()
  }

  /** 打开面板时注入初始样式并刷新 UI */
  fun bindStyle(initial: Style, lyric: String) {
    style = initial.copy()
    previewLine = lyric
    previewView.textSizeSp = style.fontSizeSp
    previewView.textColor = style.textColor
    previewView.strokeColor = style.strokeColor
    previewView.strokeWidthDp = style.strokeWidthDp
    refreshStyleUI()
  }

  private fun buildPreview() {
    previewView = FloatingLyricView(context).apply {
      // 预览不可交互
      isClickable = false
      isFocusable = false
    }
    val lp = LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT,
      LinearLayout.LayoutParams.WRAP_CONTENT,
    ).apply { bottomMargin = dp(8f).toInt() }
    panel.addView(previewView, lp)
  }

  private fun buildStepperRow(
    label: String,
    valueView: (TextView) -> Unit,
    onMinus: () -> Unit,
    onPlus: () -> Unit,
  ) {
    val row = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
    }
    row.addView(makeLabel(label), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))

    val minus = makeStepperButton("−") { onMinus() }
    row.addView(minus)

    val value = TextView(context).apply {
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
      gravity = Gravity.CENTER
      minWidth = dp(44f).toInt()
    }
    valueView(value)
    row.addView(value)

    val plus = makeStepperButton("＋") { onPlus() }
    row.addView(plus)

    val lp = LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT,
      LinearLayout.LayoutParams.WRAP_CONTENT,
    ).apply { topMargin = dp(10f).toInt() }
    panel.addView(row, lp)
  }

  private fun buildColorRow(
    label: String,
    colors: IntArray,
    swatches: MutableList<Pair<View, Int>>,
    onPick: (Int) -> Unit,
  ) {
    panel.addView(
      makeLabel(label),
      LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.WRAP_CONTENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      ).apply { topMargin = dp(14f).toInt() },
    )

    val row = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
    }
    colors.forEach { color ->
      val swatch = View(context)
      val size = dp(30f).toInt()
      val lp = LinearLayout.LayoutParams(size, size).apply {
        marginEnd = dp(8f).toInt()
        topMargin = dp(8f).toInt()
      }
      swatch.background = swatchDrawable(color, selected = false)
      swatch.setOnClickListener { onPick(color) }
      swatches.add(swatch to color)
      row.addView(swatch, lp)
    }
    panel.addView(row)
  }

  private fun buildActionRow() {
    val row = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
    }
    val lp = LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT,
      LinearLayout.LayoutParams.WRAP_CONTENT,
    ).apply { topMargin = dp(18f).toInt() }

    val openApp = makeActionButton(if (isZh) "打开应用" else "Open App", Color.WHITE) {
      onOpenApp?.invoke()
    }
    row.addView(openApp, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
      marginEnd = dp(10f).toInt()
    })

    val close = makeActionButton(if (isZh) "关闭歌词" else "Turn Off", CLOSE_BTN_COLOR) {
      onCloseLyrics?.invoke()
    }
    row.addView(close, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))

    panel.addView(row, lp)
  }

  private fun makeLabel(text: String): TextView = TextView(context).apply {
    this.text = text
    setTextColor(LABEL_COLOR)
    setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
  }

  private fun makeStepperButton(text: String, onClick: () -> Unit): TextView =
    TextView(context).apply {
      this.text = text
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
      gravity = Gravity.CENTER
      background = GradientDrawable().apply {
        setColor(BTN_BG)
        cornerRadius = dp(8f)
      }
      val size = dp(34f).toInt()
      layoutParams = LinearLayout.LayoutParams(size, size)
      setOnClickListener { onClick() }
    }

  private fun makeActionButton(text: String, textColor: Int, onClick: () -> Unit): TextView =
    TextView(context).apply {
      this.text = text
      setTextColor(textColor)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
      gravity = Gravity.CENTER
      background = GradientDrawable().apply {
        setColor(BTN_BG)
        cornerRadius = dp(10f)
      }
      setPadding(0, dp(10f).toInt(), 0, dp(10f).toInt())
      setOnClickListener { onClick() }
    }

  private fun swatchDrawable(color: Int, selected: Boolean): GradientDrawable =
    GradientDrawable().apply {
      shape = GradientDrawable.OVAL
      setColor(color)
      if (selected) {
        setStroke(dp(2.5f).toInt(), Color.WHITE)
      } else {
        setStroke(dp(1f).toInt(), 0x44FFFFFF)
      }
    }

  private fun adjustFontSize(delta: Float) {
    val next = (style.fontSizeSp + delta).coerceIn(FONT_SIZE_MIN, FONT_SIZE_MAX)
    if (next == style.fontSizeSp) return
    style.fontSizeSp = next
    refreshStyleUI()
    emitStyleChanged()
  }

  private fun adjustStrokeWidth(delta: Float) {
    val next = (style.strokeWidthDp + delta).coerceIn(STROKE_MIN, STROKE_MAX)
    if (next == style.strokeWidthDp) return
    style.strokeWidthDp = next
    refreshStyleUI()
    emitStyleChanged()
  }

  private fun refreshStyleUI() {
    fontSizeValue.text = style.fontSizeSp.toInt().toString()
    strokeWidthValue.text = String.format(Locale.US, "%.1f", style.strokeWidthDp)
    previewView.textSizeSp = style.fontSizeSp
    previewView.textColor = style.textColor
    previewView.strokeColor = style.strokeColor
    previewView.strokeWidthDp = style.strokeWidthDp
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

  private fun dp(value: Float): Float =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, resources.displayMetrics)
}
