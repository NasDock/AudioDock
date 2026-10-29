package com.audiodock.app.lyrics

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.util.TypedValue
import android.view.View
import kotlin.math.min

/**
 * 桌面歌词控制栏图标：纯 Canvas 绘制，避免依赖图片资源。
 * 支持 播放 / 暂停 / 上一首 / 下一首 / 锁定 / 解锁 六种图标。
 */
class LyricIconView(context: Context) : View(context) {

  enum class Icon { PLAY, PAUSE, PREV, NEXT, LOCK, UNLOCK }

  var icon: Icon = Icon.PLAY
    set(value) {
      if (field != value) {
        field = value
        invalidate()
      }
    }

  var iconColor: Int = Color.WHITE
    set(value) {
      field = value
      fillPaint.color = value
      strokePaint.color = value
      invalidate()
    }

  /** 图标透明度（用于锁定态高亮/置灰） */
  var iconAlpha: Float = 1f
    set(value) {
      field = value
      val a = (value.coerceIn(0f, 1f) * 255).toInt()
      fillPaint.alpha = a
      strokePaint.alpha = a
      invalidate()
    }

  private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.FILL
    color = iconColor
  }

  private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    color = iconColor
    strokeWidth = dp(2f)
    strokeCap = Paint.Cap.ROUND
    strokeJoin = Paint.Join.ROUND
  }

  private val path = Path()
  private val rect = RectF()

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    val size = dp(24f).toInt()
    setMeasuredDimension(
      resolveSize(size, widthMeasureSpec),
      resolveSize(size, heightMeasureSpec)
    )
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val cx = width / 2f
    val cy = height / 2f
    val r = min(width, height) * 0.30f

    when (icon) {
      Icon.PLAY -> {
        path.reset()
        path.moveTo(cx - r * 0.6f, cy - r)
        path.lineTo(cx - r * 0.6f, cy + r)
        path.lineTo(cx + r, cy)
        path.close()
        canvas.drawPath(path, fillPaint)
      }
      Icon.PAUSE -> {
        val barW = r * 0.55f
        val gap = r * 0.35f
        val corner = dp(1.5f)
        rect.set(cx - gap - barW, cy - r, cx - gap, cy + r)
        canvas.drawRoundRect(rect, corner, corner, fillPaint)
        rect.set(cx + gap, cy - r, cx + gap + barW, cy + r)
        canvas.drawRoundRect(rect, corner, corner, fillPaint)
      }
      Icon.PREV -> {
        // 竖条 + 左向三角
        rect.set(cx - r, cy - r, cx - r * 0.6f, cy + r)
        canvas.drawRoundRect(rect, dp(1f), dp(1f), fillPaint)
        path.reset()
        path.moveTo(cx - r * 0.25f, cy - r)
        path.lineTo(cx - r * 0.25f, cy + r)
        path.lineTo(cx + r, cy)
        path.close()
        canvas.drawPath(path, fillPaint)
      }
      Icon.NEXT -> {
        path.reset()
        path.moveTo(cx + r * 0.25f, cy - r)
        path.lineTo(cx + r * 0.25f, cy + r)
        path.lineTo(cx - r, cy)
        path.close()
        canvas.drawPath(path, fillPaint)
        rect.set(cx + r * 0.6f, cy - r, cx + r, cy + r)
        canvas.drawRoundRect(rect, dp(1f), dp(1f), fillPaint)
      }
      Icon.LOCK -> {
        drawLock(canvas, cx, cy, r, locked = true)
      }
      Icon.UNLOCK -> {
        drawLock(canvas, cx, cy, r, locked = false)
      }
    }
  }

  private fun drawLock(canvas: Canvas, cx: Float, cy: Float, r: Float, locked: Boolean) {
    // 锁体
    rect.set(cx - r * 0.85f, cy - r * 0.05f, cx + r * 0.85f, cy + r * 1.05f)
    canvas.drawRoundRect(rect, dp(3f), dp(3f), fillPaint)
    // 锁梁
    val shackle = RectF(cx - r * 0.55f, cy - r * 1.15f, cx + r * 0.55f, cy + r * 0.25f)
    if (locked) {
      canvas.drawArc(shackle, 180f, 180f, false, strokePaint)
    } else {
      // 解锁：锁梁开口朝左（留一个缺口）
      canvas.drawArc(shackle, 150f, 230f, false, strokePaint)
    }
    // 钥匙孔（镂空效果用半透明黑）
    val holePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.FILL
      color = 0x99000000.toInt()
    }
    canvas.drawCircle(cx, cy + r * 0.5f, r * 0.2f, holePaint)
  }

  private fun dp(value: Float): Float =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, resources.displayMetrics)
}
