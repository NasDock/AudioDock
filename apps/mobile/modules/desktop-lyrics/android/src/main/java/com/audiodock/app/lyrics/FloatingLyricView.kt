package com.audiodock.app.lyrics

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.util.TypedValue
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import kotlin.math.abs

/**
 * 桌面歌词悬浮窗内容 View：
 * - Paint 双遍绘制实现文字描边（先 STROKE 后 FILL）
 * - 支持拖动（回调更新 WindowManager.LayoutParams）
 * - 单击切换遮罩控制面板（具体行为由模块侧接线）
 */
class FloatingLyricView(context: Context) : View(context) {

  var lyricLine: String = ""
    set(value) {
      if (field != value) {
        field = value
        invalidate()
      }
    }

  var textSizeSp: Float = 18f
    set(value) {
      field = value
      val px = spToPx(value)
      fillPaint.textSize = px
      strokePaint.textSize = px
      invalidate()
    }

  var textColor: Int = Color.WHITE
    set(value) {
      field = value
      fillPaint.color = value
      invalidate()
    }

  var strokeColor: Int = Color.BLACK
    set(value) {
      field = value
      strokePaint.color = value
      invalidate()
    }

  var strokeWidthDp: Float = 2f
    set(value) {
      field = value
      strokePaint.strokeWidth = dpToPx(value)
      invalidate()
    }

  /** 拖动回调：dx/dy 为相对上次事件的位移（像素） */
  var onDrag: ((dx: Float, dy: Float) -> Unit)? = null

  /** 单击回调：切换遮罩控制面板 */
  var onSingleTap: (() -> Unit)? = null

  private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.FILL
    color = textColor
    textSize = spToPx(textSizeSp)
    textAlign = Paint.Align.LEFT
    isFakeBoldText = false
  }

  private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    color = strokeColor
    textSize = spToPx(textSizeSp)
    textAlign = Paint.Align.LEFT
    strokeWidth = dpToPx(strokeWidthDp)
    strokeJoin = Paint.Join.ROUND
    strokeCap = Paint.Cap.ROUND
  }

  private var downRawX = 0f
  private var downRawY = 0f
  private var lastRawX = 0f
  private var lastRawY = 0f
  private var dragging = false

  private val touchSlopPx = dpToPx(6f)

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    val text = lyricLine.ifEmpty { " " }
    val textWidth = fillPaint.measureText(text)
    val fm = fillPaint.fontMetrics
    val textHeight = fm.descent - fm.ascent
    val padH = dpToPx(20f)
    val padV = dpToPx(10f)
    val desiredW = (textWidth + padH * 2).toInt().coerceAtLeast(dpToPx(120f).toInt())
    val desiredH = (textHeight + padV * 2).toInt().coerceAtLeast(dpToPx(40f).toInt())
    setMeasuredDimension(
      resolveSize(desiredW, widthMeasureSpec),
      resolveSize(desiredH, heightMeasureSpec)
    )
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val text = lyricLine
    if (text.isEmpty()) return

    val fm = fillPaint.fontMetrics
    val textWidth = fillPaint.measureText(text)
    // 水平居中
    val x = (width - textWidth) / 2f
    // 垂直居中：baseline = centerY - (ascent + descent) / 2
    val centerY = height / 2f
    val baseline = centerY - (fm.ascent + fm.descent) / 2f

    // 先描边后填充
    canvas.drawText(text, x, baseline, strokePaint)
    canvas.drawText(text, x, baseline, fillPaint)
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        downRawX = event.rawX
        downRawY = event.rawY
        lastRawX = event.rawX
        lastRawY = event.rawY
        dragging = false
        return true
      }
      MotionEvent.ACTION_MOVE -> {
        val dx = event.rawX - lastRawX
        val dy = event.rawY - lastRawY
        if (!dragging &&
          (abs(event.rawX - downRawX) > touchSlopPx || abs(event.rawY - downRawY) > touchSlopPx)
        ) {
          dragging = true
        }
        if (dragging) {
          lastRawX = event.rawX
          lastRawY = event.rawY
          onDrag?.invoke(dx, dy)
        }
        return true
      }
      MotionEvent.ACTION_UP -> {
        if (!dragging) {
          onSingleTap?.invoke()
        }
        dragging = false
        return true
      }
      MotionEvent.ACTION_CANCEL -> {
        dragging = false
        return true
      }
    }
    return super.onTouchEvent(event)
  }

  private fun spToPx(sp: Float): Float =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, sp, resources.displayMetrics)

  private fun dpToPx(dp: Float): Float =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, dp, resources.displayMetrics)

  companion object {
    @Suppress("unused")
    private const val TAG = "FloatingLyricView"

    @Suppress("unused")
    private val UNUSED: WindowManager? = null
  }
}
