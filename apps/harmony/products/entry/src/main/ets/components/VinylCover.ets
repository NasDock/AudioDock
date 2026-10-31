/**
 * 黑胶唱片封面（对齐 mobile VinylCover.tsx / desktop fullPlayerCoverVinyl）。
 *
 * desktop 参考系 320px 圆盘，按 k = size/320 等比缩放：
 * - 底盘：径向渐变 #1a1a1a → #0a0a0a(60%) → #000（不旋转）；
 * - 旋转层：沟纹同心环（4vp 周期）+ 中央标签环 + 圆形封面，播放时 8s/圈匀速旋转；
 *   暂停停在当前帧、恢复从同一角度继续（interval 驱动角度，暂停=停表不清零，
 *   对齐 CSS animation-play-state 与 mobile reanimated 递归链的行为）；
 * - 唱针（tonearm=basic）：支点在右上角外侧，基态 -45° 朝向盘心，
 *   播放再逆时针摆 22.5°，600ms cubic-bezier(0.34,1.4,0.64,1) 回弹。
 *
 * 仅在主题 coverStyle === "vinyl" 时由 PlayerPage 使用。
 */
import curves from '@ohos.curves';
import { CoverImage } from './CoverImage';

@Component
export struct VinylCover {
  @Prop path: string | null = null;
  /** 圆盘直径（vp）。命名避开 CustomComponent 自带的 size 属性方法（同名会编译报错） */
  @Prop discSize: number = 290;
  @Prop fallbackText: string = '?';
  @Prop @Watch('onPlayingChange') isPlaying: boolean = false;
  /** 是否渲染唱针（主题 tonearm === "basic"） */
  @Prop tonearm: boolean = false;

  @State private spinAngle: number = 0;
  @State private armAngle: number = 0;
  private spinTimer: number = -1;
  /** 沟纹半径缓存：尺寸不变则不重算，避免 spinAngle 20fps 刷新时反复构建数组 */
  private grooves: number[] = [];
  private groovesForSize: number = 0;

  aboutToAppear(): void {
    this.ensureGrooves();
    this.armAngle = this.isPlaying ? -22.5 : 0;
    if (this.isPlaying) this.startSpin();
  }

  aboutToDisappear(): void {
    this.stopSpin();
  }

  onPlayingChange(): void {
    if (this.isPlaying) {
      this.startSpin();
    } else {
      this.stopSpin();
    }
    animateTo({
      duration: 600,
      curve: curves.cubicBezierCurve(0.34, 1.4, 0.64, 1),
    }, (): void => {
      this.armAngle = this.isPlaying ? -22.5 : 0;
    });
  }

  /** 8s/360° → 每 50ms 走 2.25°；暂停只停表不清角，恢复从同一帧继续 */
  private startSpin(): void {
    if (this.spinTimer !== -1) return;
    this.spinTimer = setInterval((): void => {
      this.spinAngle = (this.spinAngle + 2.25) % 360;
    }, 50);
  }

  private stopSpin(): void {
    if (this.spinTimer !== -1) {
      clearInterval(this.spinTimer);
      this.spinTimer = -1;
    }
  }

  private k(): number {
    return this.discSize / 320;
  }

  private labelR(): number {
    return 70 * this.k();
  }

  private imgSize(): number {
    return 130 * this.k();
  }

  private ensureGrooves(): void {
    if (this.groovesForSize === this.discSize && this.grooves.length > 0) return;
    const k = this.k();
    const list: number[] = [];
    const start = this.labelR() + 6 * k;
    const end = this.discSize / 2 - 18 * k;
    for (let r = start; r <= end; r += 4 * k) {
      list.push(r);
    }
    this.grooves = list;
    this.groovesForSize = this.discSize;
  }

  build() {
    Stack() {
      // ─── 底盘（静态）：径向渐变黑胶底 ───
      Column()
        .width(this.discSize)
        .height(this.discSize)
        .borderRadius(this.discSize / 2)
        .radialGradient({
          center: [this.discSize / 2, this.discSize / 2],
          radius: this.discSize / 2,
          colors: [['#FF1A1A1A', 0.0], ['#FF0A0A0A', 0.6], ['#FF000000', 1.0]],
        })
        .shadow({ radius: 30 * this.k(), color: '#59000000', offsetX: 0, offsetY: 10 * this.k() })

      // ─── 旋转层：沟纹 + 标签环 + 圆形封面 ───
      Stack() {
        ForEach(this.grooves, (r: number) => {
          Circle()
            .width(r * 2)
            .height(r * 2)
            .fillOpacity(0)
            .stroke('rgba(255,255,255,0.05)')
            .strokeWidth(Math.max(1, this.k()))
        }, (r: number) => r.toFixed(2))

        // 中央标签外圈高光
        Circle()
          .width(this.labelR() * 2)
          .height(this.labelR() * 2)
          .fillOpacity(0)
          .stroke('rgba(255,255,255,0.08)')
          .strokeWidth(2 * this.k())

        CoverImage({
          path: this.path,
          imgWidth: this.imgSize(),
          imgHeight: this.imgSize(),
          radius: this.imgSize() / 2,
          fallbackText: this.fallbackText,
        })
      }
      .width(this.discSize)
      .height(this.discSize)
      .rotate({ angle: this.spinAngle })

      // ─── 唱针（可选）：wrapper 中心 = 支点，整体 0° ↔ -22.5° 摆动 ───
      if (this.tonearm) {
        this.tonearmView()
      }
    }
    .width(this.discSize)
    .height(this.discSize)
    // 唱针 wrapper 超出盘体（右上角外侧），父容器不 clip
    .clip(false)
  }

  @Builder
  tonearmView() {
    // 常量按 320 参考系缩放（@Builder 内禁 const，用辅助函数返回值直接展开）
    Stack() {
      // 臂 + 唱头组：先画成水平（支点在右端），再整体 -45° 指向盘心
      Stack() {
        Row()
          .width(this.armLen())
          .height(4 * this.k())
          .borderRadius(2 * this.k())
          .linearGradient({
            angle: 0,
            colors: [['#FFC0C0C0', 0.0], ['#FF808080', 0.4], ['#FF4A4A4A', 1.0]],
          })
        // 唱头：嵌在臂左端，跟随臂的旋转
        Column()
          .width(12 * this.k())
          .height(18 * this.k())
          .borderRadius(2 * this.k())
          .linearGradient({
            angle: 180,
            colors: [['#FF2A2A2A', 0.0], ['#FF000000', 1.0]],
          })
          .position({ x: -6 * this.k(), y: -7 * this.k() })
      }
      .width(this.armLen())
      .height(4 * this.k())
      .position({ x: this.reach() - this.armLen(), y: this.reach() - 2 * this.k() })
      .rotate({ angle: -45, centerX: this.armLen(), centerY: 2 * this.k() })

      // 支点圆盘
      Circle()
        .width(14 * this.k())
        .height(14 * this.k())
        .fill('#FF333333')
        .position({ x: this.reach() - 7 * this.k(), y: this.reach() - 7 * this.k() })
    }
    .width(this.reach() * 2)
    .height(this.reach() * 2)
    .position({ x: this.pivotX() - this.reach(), y: this.pivotY() - this.reach() })
    .rotate({ angle: this.armAngle })
    .zIndex(3)
  }

  private armLen(): number {
    return 220 * this.k();
  }

  private reach(): number {
    return this.armLen() + 12 * this.k();
  }

  /** 支点：右上角略出盘外（对齐 desktop top:-10 right:-10） */
  private pivotX(): number {
    return this.discSize + 4 * this.k();
  }

  private pivotY(): number {
    return 2 * this.k();
  }
}
