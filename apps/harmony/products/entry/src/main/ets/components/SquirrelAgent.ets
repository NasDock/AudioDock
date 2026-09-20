import promptAction from '@ohos.promptAction';
import type { common } from '@kit.AbilityKit';
import { buildTheme } from 'features_ui';
import type { Theme, ThemeMode } from 'features_ui';
import { t } from 'features_i18n';
import { Logger } from 'audiodock_common';
import type { Track } from '../context/PlayerStore';
import { playerStore } from '../context/PlayerStore';
import { playQueueFast } from '../services/trackResolver';
import {
  ensureMicPermission, startRecording, stopRecording,
  speechToText, extractIntent, searchAll,
} from '../services/speechService';

const TAG = 'SquirrelAgent';
const SQUIRREL_SIZE = 70;
const EDGE_MARGIN = 10;
const RESULT_DURATION_MS = 6000;

type AgentState = 'idle' | 'listening' | 'processing' | 'result';

/**
 * 全局语音助手「小松鼠」，对齐 mobile SquirrelAgent.tsx：
 * 悬浮可拖拽按钮，点按开始/停止录音 → ASR 转文字 → LLM 意图解析（/llm/chat）→
 * 执行播放指令（next/last/pause/play/random/song_/alum_/arist_/list_），
 * 并以气泡展示识别结果。仅在主页（MainPage）挂载，播放详情页天然不显示。
 */
@Component
export struct SquirrelAgent {
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  // 车机模式下强制贴左（对齐 mobile SquirrelAgent 的 carLayoutMode 分支）
  @StorageLink('carModeEnabled') @Watch('onCarModeChange') carModeEnabled: boolean = false;
  @State theme: Theme = buildTheme('light');
  @State state: AgentState = 'idle';
  @State resultText: string = '';
  @State posX: number = -1;
  @State posY: number = -1;
  @State containerW: number = 0;
  @State containerH: number = 0;
  @State pulseScale: number = 1;
  @State spinAngle: number = 0;
  private pulseTimer: number = -1;
  private spinTimer: number = -1;
  private hideTimer: number = -1;
  private gestureStartX: number = 0;
  private gestureStartY: number = 0;

  aboutToAppear(): void {
    this.theme = buildTheme(this.themeMode);
    // 启动时如果已经开了车机模式，立即贴左
    if (this.carModeEnabled && this.containerW > 0) {
      this.posX = EDGE_MARGIN;
    }
  }

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  /**
   * 车机模式开关变化：开启 → 强制贴左；关闭 → 恢复默认贴右（initPosIfNeeded 走原逻辑）。
   * 对齐 mobile SquirrelAgent 的 carLayoutMode useEffect 分支。
   */
  onCarModeChange(): void {
    if (this.carModeEnabled) {
      this.posX = EDGE_MARGIN;
    } else if (this.containerW > 0) {
      this.posX = this.containerW - SQUIRREL_SIZE - EDGE_MARGIN;
    }
  }

  aboutToDisappear(): void {
    this.stopPulse();
    this.stopSpin();
    if (this.hideTimer !== -1) { clearTimeout(this.hideTimer); this.hideTimer = -1; }
  }

  private initPosIfNeeded(): void {
    if (this.posX < 0 && this.containerW > 0 && this.containerH > 0) {
      this.posX = this.containerW - SQUIRREL_SIZE - EDGE_MARGIN;
      this.posY = this.containerH / 2;
    }
  }

  private clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
  }

  private snapToEdge(): void {
    if (this.containerW <= 0) return;
    // 车机模式下强制贴左，让出右侧完整内容区（对齐 mobile SquirrelAgent）
    if (this.carModeEnabled) {
      this.posX = EDGE_MARGIN;
      return;
    }
    const centerX = this.posX + SQUIRREL_SIZE / 2;
    this.posX = centerX > this.containerW / 2
      ? this.containerW - SQUIRREL_SIZE - EDGE_MARGIN
      : EDGE_MARGIN;
  }

  // ─── 动画 ───
  private startPulse(): void {
    this.stopPulse();
    this.pulseTimer = setInterval(() => {
      this.pulseScale = this.pulseScale > 1 ? 1 : 1.15;
    }, 600);
  }

  private stopPulse(): void {
    if (this.pulseTimer !== -1) { clearInterval(this.pulseTimer); this.pulseTimer = -1; }
    this.pulseScale = 1;
  }

  private startSpin(): void {
    this.stopSpin();
    this.spinTimer = setInterval(() => { this.spinAngle += 360; }, 1500);
  }

  private stopSpin(): void {
    if (this.spinTimer !== -1) { clearInterval(this.spinTimer); this.spinTimer = -1; }
  }

  private setState(s: AgentState): void {
    this.state = s;
    if (s === 'listening') this.startPulse();
    else this.stopPulse();
    if (s === 'processing') this.startSpin();
    else this.stopSpin();
  }

  // ─── 交互 ───
  private async handlePress(): Promise<void> {
    if (this.state === 'idle') await this.beginListen();
    else if (this.state === 'listening') await this.finishListen();
  }

  private async beginListen(): Promise<void> {
    const ctx = getContext(this) as common.Context;
    const granted = await ensureMicPermission(ctx);
    if (!granted) return;
    // 对齐 mobile：录音前先暂停当前播放
    if (playerStore.isPlaying) {
      try { await playerStore.togglePlay(); } catch (e) { /* ignore */ }
    }
    const path = await startRecording(ctx);
    if (path.length === 0) {
      promptAction.showToast({ message: t('search.voiceStart') });
      return;
    }
    this.setState('listening');
  }

  private async finishListen(): Promise<void> {
    this.setState('processing');
    const path = await stopRecording();
    if (path.length === 0) { this.setState('idle'); return; }
    try {
      const ctx = getContext(this) as common.Context;
      let text = await speechToText(ctx, path);
      if (text.trim().length > 0) {
        const intent = await extractIntent(text);
        if (intent && intent.prompt.length > 0 && intent.text.length > 0) {
          text = intent.text;
          this.executeIntent(intent.prompt);
        } else {
          text = t('squirrel.notUnderstood');
        }
      } else {
        text = t('squirrel.notUnderstood');
      }
      this.showResult(text);
    } catch (e) {
      Logger.w(TAG, `finishListen failed: ${String(e)}`);
      this.showResult(t('squirrel.notUnderstood'));
    }
  }

  private executeIntent(prompt: string): void {
    setTimeout(async () => {
      try {
        if (prompt === 'next') {
          await playerStore.playNext();
        } else if (prompt === 'last') {
          await playerStore.playPrevious();
        } else if (prompt === 'pause') {
          if (playerStore.isPlaying) await playerStore.togglePlay();
        } else if (prompt === 'play') {
          if (!playerStore.isPlaying) await playerStore.togglePlay();
        } else if (prompt === 'random') {
          playerStore.setMode('SHUFFLE');
          if (!playerStore.isPlaying) await playerStore.togglePlay();
        } else if (prompt.startsWith('song_') || prompt.startsWith('alum_')
          || prompt.startsWith('arist_') || prompt.startsWith('list_')) {
          const kw = prompt.substring(prompt.indexOf('_') + 1);
          if (kw.length > 0) await this.playByKeyword(kw);
        }
      } catch (e) {
        Logger.w(TAG, `executeIntent failed: ${String(e)}`);
      }
    }, 100);
  }

  private async playByKeyword(kw: string): Promise<void> {
    const res = await searchAll(kw);
    if (res.tracks.length === 0) return;
    // 秒播：先播第 0 首，完整结果列表后台并行补齐
    await playQueueFast(res.tracks, 0, false);
  }

  private showResult(text: string): void {
    this.resultText = text;
    this.setState('result');
    if (this.hideTimer !== -1) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.resultText = '';
      this.setState('idle');
      this.snapToEdge();
      this.hideTimer = -1;
    }, RESULT_DURATION_MS);
  }

  private onSideRight(): boolean {
    return this.posX + SQUIRREL_SIZE / 2 > this.containerW / 2;
  }

  build() {
    Stack() {
      // 结果气泡
      if (this.state === 'result' && this.resultText.length > 0) {
        Column() {
          Text(this.resultText)
            .fontSize(14)
            .fontColor(this.theme.colors.text)
        }
        .padding(14)
        .constraintSize({ minWidth: 200, maxWidth: 280 })
        .borderRadius(18)
        .backgroundColor(this.theme.colors.surface)
        .shadow({ radius: 8, color: '#33000000', offsetY: 2 })
        .position({
          x: this.clamp(this.onSideRight() ? this.posX - 220 : this.posX + SQUIRREL_SIZE + 10,
            EDGE_MARGIN, Math.max(EDGE_MARGIN, this.containerW - 290)),
          y: Math.max(EDGE_MARGIN, this.posY - 40),
        })
      }

      // 小松鼠按钮
      Stack({ alignContent: Alignment.Center }) {
        Column() {
          Image($r('app.media.squirrel'))
            .width('100%').height('100%')
            .objectFit(ImageFit.Contain)
        }
        .width(SQUIRREL_SIZE).height(SQUIRREL_SIZE)
        .borderRadius(SQUIRREL_SIZE / 2)
        .padding(5)
        .backgroundColor(this.theme.mode === 'festive' ? '#D4AF37' : this.theme.colors.primary + '33')
        .shadow({ radius: 5, color: '#4D000000', offsetY: 4 })
        .scale({ x: this.pulseScale, y: this.pulseScale })
        .animation({ duration: 600 })

        if (this.state === 'processing') {
          Column()
            .width(SQUIRREL_SIZE).height(SQUIRREL_SIZE)
            .borderRadius(SQUIRREL_SIZE / 2)
            .border({ width: 3, color: '#FFD700', style: BorderStyle.Dashed })
            .rotate({ angle: this.spinAngle })
            .animation({ duration: 1500, curve: Curve.Linear })
        }
      }
      .width(SQUIRREL_SIZE).height(SQUIRREL_SIZE)
      .position({ x: this.posX, y: this.posY })
      .onClick(() => { this.handlePress(); })
      .gesture(
        PanGesture()
          .onActionStart(() => {
            this.gestureStartX = this.posX;
            this.gestureStartY = this.posY;
          })
          .onActionUpdate((event: GestureEvent) => {
            if (this.gestureStartX < 0) return;
            // 车机模式下禁用水平拖动，只允许垂直调整（snapToEnd 时强制贴左）
            if (this.carModeEnabled) {
              this.posY = this.clamp(this.gestureStartY + event.offsetY,
                0, Math.max(0, this.containerH - SQUIRREL_SIZE));
              return;
            }
            this.posX = this.clamp(this.gestureStartX + event.offsetX,
              0, Math.max(0, this.containerW - SQUIRREL_SIZE));
            this.posY = this.clamp(this.gestureStartY + event.offsetY,
              0, Math.max(0, this.containerH - SQUIRREL_SIZE));
          })
          .onActionEnd(() => {
            this.gestureStartX = -1;
            this.snapToEdge();
          })
      )
    }
    .width('100%').height('100%')
    .hitTestBehavior(HitTestMode.Transparent)
    .onAreaChange((_old: Area, newVal: Area) => {
      this.containerW = newVal.width as number;
      this.containerH = newVal.height as number;
      this.initPosIfNeeded();
    })
  }
}
