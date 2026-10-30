import { avSession } from '@kit.AVSessionKit';
import { common, wantAgent } from '@kit.AbilityKit';
import { backgroundTaskManager } from '@kit.BackgroundTasksKit';
import { image } from '@kit.ImageKit';
import { http } from '@kit.NetworkKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { Logger } from 'audiodock_common';
import { kvStore } from 'features_storage';
import { util } from '@kit.ArkTS';
import { audioBackend } from 'features_player';
import { playerStore } from '../context/PlayerStore';
import type { Track, PlayMode } from '../context/PlayerStore';
import { getImageUrl } from '../utils/image';

/** position 跳变超过该值（ms）且与「期望进度」不符才视为真实 seek，立即下发播放态。
 *  关键：不能用「距上次上报的跳变」判断——timeUpdate 间隔（~2s）大于该阈值时，
 *  进度自然前进会每次都被误判成 seek，导致 isReportOverSize 限频（本次根因 B）。 */
const SEEK_JUMP_THRESHOLD_MS = 1500;
/** setAVPlaybackState 最小下发间隔（ms）：系统对高频上报做 isReportOverSize 限频直接拒绝。 */
const MIN_STATE_REPORT_INTERVAL_MS = 500;
/** AVMetadata.lyric 字节上限（官方约束 < 40960 字节），超出系统解析失败。 */
const MAX_LYRIC_BYTES = 40960;

/**
 * 把 LRC 歌词裁剪到 AVMetadata.lyric 的字节上限内（按行边界截断，避免半行导致解析异常）。
 * 系统只支持 Simple LRC（[mm:ss.xx] 时间标签 + 文本），原文一般远小于 40KB，此函数是防御性兜底。
 */
function clampLrcForMetadata(lrc: string): string {
  if (!lrc) return '';
  const encoder = util.TextEncoder.create('utf-8');
  if (encoder.encodeInto(lrc).length < MAX_LYRIC_BYTES) return lrc;
  // 超限时按行累计字节，保留尽可能多的完整行
  const lines = lrc.split('\n');
  let total = 0;
  let end = 0;
  for (let i = 0; i < lines.length; i++) {
    // +1 是换行符本身的字节
    total += encoder.encodeInto(lines[i]).length + 1;
    if (total >= MAX_LYRIC_BYTES) break;
    end = i + 1;
  }
  Logger.w('AVSession', `lyric exceeds ${MAX_LYRIC_BYTES}B, truncated to ${end}/${lines.length} lines`);
  return lines.slice(0, end).join('\n');
}

let session: avSession.AVSession | null = null;
let abilityContext: common.UIAbilityContext | null = null;
/** 会话是否已 activate（首次真正播放时触发）。 */
let sessionActivated: boolean = false;
/** activate 完成后需要补发一次元数据 + 播放态（未激活时发的可能被系统丢弃）。 */
let pendingMetadata: (() => void) | null = null;

/** 上一次已下发的元数据指纹，用于「仅在切歌时」setAVMetadata。 */
let lastMetadataKey: string = '';
/** 上一次 setAVMetadata 是否成功（失败时下次状态变化要重试，否则指纹缓存会导致永远不重发）。 */
let lastMetadataOk: boolean = false;
/** 上一次已下发的播放态。 */
let lastPlaybackState: avSession.PlaybackState = avSession.PlaybackState.PLAYBACK_STATE_PAUSE;
/** 上一次已下发的进度（ms），用于 seek 跳变检测。 */
let lastPositionMs: number = 0;
/** 上一次已下发的倍速。 */
let lastSpeed: number = 1.0;
/** 上一次已下发的时长（ms）。 */
let lastDurationMs: number = 0;
/** 上一次已下发的循环模式，用于变化时才下发 loopMode。 */
let lastLoopMode: avSession.LoopMode = avSession.LoopMode.LOOP_MODE_SEQUENCE;
/** 上一次实际调用 setAVPlaybackState 的时间戳（ms），用于最小间隔节流 + 期望进度推算。 */
let lastStateReportAt: number = 0;
/** 上一次下发时的播放状态（用于期望进度推算：播放中才随时间前进）。 */
let lastReportedIsPlaying: boolean = false;
/** 节流窗口内被合并的待发状态（trailing 补发，保证系统最终拿到最新状态）。 */
let pendingState: PendingPlaybackState | null = null;
let pendingStateTimer: number = -1;

interface PendingPlaybackState {
  state: avSession.PlaybackState;
  currentMs: number;
  durationMs: number;
  speed: number;
  loopMode: avSession.LoopMode;
}

/** PlayerStore.PlayMode → AVSession.LoopMode 一对一映射。播控中心只认这四种值，
 *  自定义模式（如「心动模式」）必须就近映射，否则通知栏会按 SEQUENCE 显示。 */
function mapPlayModeToLoopMode(pm: PlayMode): avSession.LoopMode {
  switch (pm) {
    case 'LOOP_SINGLE':
      return avSession.LoopMode.LOOP_MODE_SINGLE;
    case 'LOOP_LIST':
      return avSession.LoopMode.LOOP_MODE_LIST;
    case 'SHUFFLE':
      return avSession.LoopMode.LOOP_MODE_SHUFFLE;
    case 'SEQUENCE':
    default:
      return avSession.LoopMode.LOOP_MODE_SEQUENCE;
  }
}

/** AVSession.LoopMode → PlayerStore.PlayMode 反向映射。用户从通知栏/控制中心切循环模式时
 *  系统会回调 setLoopMode，需要把系统值转成本地 PlayMode 写回 PlayerStore。 */
function mapLoopModeToPlayMode(lm: avSession.LoopMode): PlayMode {
  switch (lm) {
    case avSession.LoopMode.LOOP_MODE_SINGLE:
      return 'LOOP_SINGLE';
    case avSession.LoopMode.LOOP_MODE_LIST:
      return 'LOOP_LIST';
    case avSession.LoopMode.LOOP_MODE_SHUFFLE:
      return 'SHUFFLE';
    case avSession.LoopMode.LOOP_MODE_SEQUENCE:
    case avSession.LoopMode.LOOP_MODE_CUSTOM:
    default:
      return 'SEQUENCE';
  }
}

export async function installAVSessionService(context: common.UIAbilityContext): Promise<void> {
  abilityContext = context;
  session = await avSession.createAVSession(context, 'AudioDockPlayer', 'audio');
  // 注意：这里只创建会话，不 activate。
  // activate 挪到首次真正播放时（pushPlaybackState 里 isPlaying=true 时触发），
  // 避免系统把「激活但从未播放」的会话当成无效会话。

  // 0. 声明投播能力（对齐 AudioCast AVSessionController.ets:68）。
  // 不调这个 setExtras，系统不认 AVSession 是音频代理，不会发出 outputDeviceChange，
  // 通知栏/控制中心的播控卡片也不会出现。这是「投播」链路的核心前提。
  try {
    await session.setExtras({ 'requireAbilityList': ['url-cast'] });
    Logger.i('AVSession', 'extras set: requireAbilityList=[url-cast]');
  } catch (e) {
    Logger.w('AVSession', `setExtras failed: ${String(e)}`);
  }

  // 1. 注册系统播控按键监听（通知栏播控卡片 / 锁屏 / 耳机线控 / 车机）
  bindControlCommands();

  // 2. 订阅 PlayerStore，把元数据 + 播放态同步给系统
  bindPlayerEvents();

  // 3. 申请 AUDIO_PLAYBACK 后台长时任务（系统播控卡片出现的前提之一）
  await startAudioBackgroundTask();

  // 4. 配置点击通知栏播控卡片回跳 EntryAbility
  await bindLaunchWantAgent(context);

  // 5. 桌面歌词（系统歌词组件，API 23+）：能力检测 + 状态监听 + 按设置恢复。
  // 歌词本体走 pushMetadata 的 AVMetadata.lyric 下发，这里只管使能与可见性。
  initDesktopLyric().catch((e: Error): void => {
    Logger.w('AVSession', `initDesktopLyric: ${String(e)}`);
  });

  Logger.i('AVSession', 'installed (session created, activate deferred to first play)');
}

export function releaseAVSessionService(): void {
  stopAudioBackgroundTask();
  if (pendingStateTimer >= 0) {
    clearTimeout(pendingStateTimer);
    pendingStateTimer = -1;
  }
  pendingState = null;
  if (session) {
    // 桌面歌词监听随会话销毁自动失效，显式 off 一次兜底
    try {
      session.offDesktopLyricVisibilityChanged();
      session.offDesktopLyricStateChanged();
    } catch (e) { /* 低版本无桌面歌词 API，忽略 */ }
    session.destroy().catch(() => undefined);
    session = null;
  }
  desktopLyricSupported = false;
  desktopLyricSupportChecked = false;
  pendingDesktopLyricRestore = false;
  abilityContext = null;
  sessionActivated = false;
  pendingMetadata = null;
  lastMetadataKey = '';
  lastMetadataOk = false;
  lastStateReportAt = 0;
  lastReportedIsPlaying = false;
  audioBackend.release().catch(() => undefined);
}

// ────────────────────────────────────────────────────────────
// 系统播控按键 → PlayerStore
// ────────────────────────────────────────────────────────────

function bindControlCommands(): void {
  if (!session) return;
  session.on('play', (): void => {
    Logger.i('AVSession', 'cmd: play');
    playerStore.resume().catch((e: Error): void => {
      Logger.w('AVSession', `resume failed: ${String(e)}`);
    });
  });
  session.on('pause', (): void => {
    Logger.i('AVSession', 'cmd: pause');
    playerStore.pause().catch((e: Error): void => {
      Logger.w('AVSession', `pause failed: ${String(e)}`);
    });
  });
  session.on('playNext', (): void => {
    Logger.i('AVSession', 'cmd: playNext');
    playerStore.playNext().catch((e: Error): void => {
      Logger.w('AVSession', `playNext failed: ${String(e)}`);
    });
  });
  session.on('playPrevious', (): void => {
    Logger.i('AVSession', 'cmd: playPrevious');
    playerStore.playPrevious().catch((e: Error): void => {
      Logger.w('AVSession', `playPrevious failed: ${String(e)}`);
    });
  });
  session.on('seek', (timeMs: number): void => {
    Logger.i('AVSession', `cmd: seek ${timeMs}`);
    playerStore.seek(timeMs).catch((e: Error): void => {
      Logger.w('AVSession', `seek failed: ${String(e)}`);
    });
  });
  session.on('setSpeed', (speed: number): void => {
    Logger.i('AVSession', `cmd: setSpeed ${speed}`);
    playerStore.setSpeed(speed).catch((e: Error): void => {
      Logger.w('AVSession', `setSpeed failed: ${String(e)}`);
    });
  });
  // 用户从通知栏/控制中心切循环模式 → 系统回调 → 反向映射写回 PlayerStore。
  // 对齐 AudioCast ControlAreaComponent.ets:252（监听 setLoopMode 后切换应用内部 playMode）。
  session.on('setLoopMode', (mode: avSession.LoopMode): void => {
    Logger.i('AVSession', `cmd: setLoopMode ${mode}`);
    const next = mapLoopModeToPlayMode(mode);
    playerStore.setMode(next);
  });
}

// ────────────────────────────────────────────────────────────
// PlayerStore → AVSession 元数据 / 播放态
// ────────────────────────────────────────────────────────────

function bindPlayerEvents(): void {
  playerStore.subscribe((): void => {
    if (!session) return;
    const v = playerStore.view();
    const track: Track | undefined = v.queue[v.currentIndex];
    pushMetadata(track, v.durationMs);
    pushPlaybackState(v.isPlaying, v.currentMs, v.durationMs, v.speed, v.playMode);
    // 队列被清空/播完停止（clear() 后 currentIndex=-1 且不在播放）时及时停掉长时任务，
    // 避免空挂被系统判违规（Background TasksKit 接入规范要求任务结束主动 stop）。
    if (!v.isPlaying && v.currentIndex < 0) {
      stopAudioBackgroundTask();
    }
  });
}

/**
 * 元数据仅在「曲目身份变化」时下发一次。
 * 指纹 = id + title + artist + album + duration，避免 timeUpdate 高频重复触发。
 * 封面：coverUrl 是 http(s) URL，AVSession 只接受 PixelMap，必须先下载解码。
 *
 * 注意：会话未激活时 setAVMetadata 可能被系统丢弃，所以首次 activate 后需要补发。
 */
function pushMetadata(track: Track | undefined, durationMs: number): void {
  if (!session) return;
  const key = track
    ? `${track.id}|${track.title}|${track.artist ?? ''}|${track.album ?? ''}|${durationMs}`
    : '';
  // 指纹相同且上次确实成功才跳过；上次失败（如 activate 竞态）下次状态变化必须重试
  if (key === lastMetadataKey && lastMetadataOk) return;
  lastMetadataKey = key;
  Logger.i('AVSession', `push metadata: id=${track?.id ?? 'empty'} title=${track?.title ?? ''} artist=${track?.artist ?? ''} album=${track?.album ?? ''} dur=${durationMs} cover=${track?.coverUrl ?? 'none'}`);

  const doSet = (): void => {
    if (!session) return;
    // 注意：assetId 必须显式转 string——track.id 声明是 string 但运行时是 number
    // （JSON 反序列化保留 number），直接传会报 401 参数错误（已抓包确认）。
    const meta: avSession.AVMetadata = {
      assetId: String(track?.id ?? ''),
      title: track?.title ?? '',
      artist: track?.artist ?? '',
      album: track?.album ?? '',
      duration: durationMs,
      // 桌面歌词（系统歌词组件，API 23+）：歌词以 LRC 原文随元数据下发，
      // 系统播控中心按 AVPlaybackState 进度自行解析并切换歌词行。
      // 官方要求：元数据必须包含 lyric 字段，否则桌面歌词功能不生效。
      lyric: clampLrcForMetadata(track?.lyrics ?? ''),
    };
    session.setAVMetadata(meta)
      .then((): void => {
        lastMetadataOk = true;
        Logger.i('AVSession', `metadata set ok: ${track?.title ?? 'empty'}`);
      })
      .catch((e: Error): void => {
        lastMetadataOk = false;
        const be = e as BusinessError;
        Logger.e('AVSession', `setAVMetadata failed: code=${be.code} msg=${be.message} data=${JSON.stringify(meta)}`);
        // 401 参数错误不会自愈（assetId 类型错误等），重试无意义，停止避免无限循环
        if (be.code === 401) {
          lastMetadataOk = true; // 标记为"已处理"防止下次状态变化又重试
        }
      });
  };

  if (!sessionActivated) {
    // 会话还没激活，先记下来，activate 完成后补发
    pendingMetadata = doSet;
    return;
  }
  doSet();

  // 封面异步下载解码，成功后补发一条带 mediaImage 的元数据
  // track.coverUrl 是相对路径（/covers/...），需经 getImageUrl 拼 baseURL 并走缩略图代理。
  // 用 600 档（通知栏卡片实际显示尺寸约 300vp×2），平衡清晰度与下载耗时。
  const rawCover = track?.coverUrl;
  if (rawCover) {
    const coverUrl = getImageUrl(rawCover, 600);
    if (coverUrl.startsWith('http://') || coverUrl.startsWith('https://')) {
      fetchCoverPixelMap(coverUrl)
        .then((pm: image.PixelMap): void => {
          if (!session) return;
          // 曲目已切走则放弃，避免旧封面盖到新曲
          if (lastMetadataKey !== key) return;
          const metaWithCover: avSession.AVMetadata = {
            assetId: String(track?.id ?? ''),
            title: track?.title ?? '',
            artist: track?.artist ?? '',
            album: track?.album ?? '',
            duration: durationMs,
            // 封面补发必须带上 lyric，否则同 assetId 的二次 setAVMetadata 会把歌词清掉
            lyric: clampLrcForMetadata(track?.lyrics ?? ''),
            mediaImage: pm,
          };
          session.setAVMetadata(metaWithCover)
            .then((): void => { Logger.i('AVSession', `metadata set with cover: ${track?.title ?? ''}`); })
            .catch((e: Error): void => {
              Logger.w('AVSession', `setAVMetadata(cover) failed: ${String(e)}`);
            });
        })
        .catch((e: Error): void => {
          Logger.w('AVSession', `fetch cover failed: ${String(e)}`);
        });
    }
  }
}

/**
 * 播放态下发策略（关键：避免触发系统 isReportOverSize 限频）：
 * - 状态翻转（play ↔ pause）立即下发；
 * - position 跳变（seek）立即下发；
 * - 倍速变化立即下发；
 * - **进度不持续上报**——系统根据 position.elapsedTime + (now - updateTime) * speed 自己推算。
 */
function pushPlaybackState(
  isPlaying: boolean,
  currentMs: number,
  durationMs: number,
  speed: number,
  playMode: PlayMode,
): void {
  if (!session) return;
  const nextState = isPlaying
    ? avSession.PlaybackState.PLAYBACK_STATE_PLAY
    : avSession.PlaybackState.PLAYBACK_STATE_PAUSE;
  const nextLoopMode = mapPlayModeToLoopMode(playMode);

  const stateFlipped = nextState !== lastPlaybackState;
  // seek 判定（核心修复）：与「期望进度」比较，而不是与「上次上报值」比较。
  // 期望进度 = 上次上报的 position + 播放时长 × speed（与系统侧推算公式一致）。
  // timeUpdate 自然前进 ~2s/次，与期望进度几乎重合（diff≈0）→ 不触发；
  // 用户真实 seek（跳几分钟/拖到任意位置）与期望进度差距巨大 → 触发。
  const expectedMs = lastReportedIsPlaying
    ? lastPositionMs + (Date.now() - lastStateReportAt) * lastSpeed
    : lastPositionMs;
  const seekJumped = Math.abs(currentMs - expectedMs) > SEEK_JUMP_THRESHOLD_MS;
  const speedChanged = speed !== lastSpeed;
  // duration 已在 AVMetadata 里给过系统，这里只在「首次拿到有效 duration」时随状态补一次，
  // 之后不再因 duration 触发上报（避免 durationUpdate 阶段被 isReportOverSize 限频）
  const durationChanged = lastDurationMs === 0 && durationMs > 0;
  const loopModeChanged = nextLoopMode !== lastLoopMode;

  // 首次真正播放时 activate + 显式声明后台播放模式（API 24+）。
  if (isPlaying && !sessionActivated) {
    sessionActivated = true;
    session.activate()
      .then((): Promise<void> => {
        Logger.i('AVSession', 'session activated');
        return session!.setBackgroundPlayMode(avSession.BackgroundPlayMode.ENABLE_BACKGROUND_PLAY);
      })
      .then((): void => {
        Logger.i('AVSession', 'background play mode enabled');
        // activate 完成后补发元数据（未激活时发的可能被丢弃）
        if (pendingMetadata) {
          pendingMetadata();
          pendingMetadata = null;
        }
        // 补发一次播放态，确保系统拿到最新状态
        doPushPlaybackState(nextState, currentMs, durationMs, speed, nextLoopMode);
        // 桌面歌词：install 阶段（会话未激活）恢复失败时，activate 后重试一次
        if (pendingDesktopLyricRestore) {
          pendingDesktopLyricRestore = false;
          setDesktopLyricEnabled(true).then((ok: boolean): void => {
            if (!ok) Logger.w('AVSession', 'desktop lyric restore retry after activate failed');
          }).catch((): void => undefined);
        }
      })
      .catch((e: Error): void => {
        Logger.w('AVSession', `activate/setBackgroundPlayMode: ${String(e)}`);
      });
    // activate 是异步的，这里先更新本地状态，避免重复触发
    lastPlaybackState = nextState;
    lastPositionMs = currentMs;
    lastSpeed = speed;
    lastDurationMs = durationMs;
    lastLoopMode = nextLoopMode;
    lastReportedIsPlaying = isPlaying;
    // 首次播放时同步申请后台长时任务（防止 installAVSessionService 申请过但被系统回收）
    startAudioBackgroundTask().catch((): void => undefined);
    return;
  }

  // 对齐官方 AudioCast（AudioRendererController.ets L225/L270）：每次进入播放都重新申请
  // 后台长时任务——任务超过系统回收阈值后会被静默回收，只有重新申请才能让
  // 通知栏/控制中心播控卡片持续有效。startBackgroundRunning 幂等，重复调用无副作用。
  if (isPlaying && stateFlipped) {
    startAudioBackgroundTask().catch((): void => undefined);
  }

  if (!stateFlipped && !seekJumped && !speedChanged && !durationChanged && !loopModeChanged) return;
  if (!sessionActivated) return;

  Logger.i('AVSession', `push state: flip=${stateFlipped} seek=${seekJumped} speed=${speedChanged} dur=${durationChanged} loop=${loopModeChanged} pos=${currentMs} lastPos=${lastPositionMs} durMs=${durationMs} lastDur=${lastDurationMs}`);
  doPushPlaybackState(nextState, currentMs, durationMs, speed, nextLoopMode);
}

function doPushPlaybackState(
  state: avSession.PlaybackState,
  currentMs: number,
  durationMs: number,
  speed: number,
  loopMode: avSession.LoopMode,
): void {
  if (!session) return;
  // 最小间隔节流：系统对高频 setAVPlaybackState 做 isReportOverSize 限频直接拒绝。
  // 窗口内的调用合并成 trailing 一次补发，保证系统最终拿到的是最新状态。
  const now = Date.now();
  const sinceLast = now - lastStateReportAt;
  if (sinceLast < MIN_STATE_REPORT_INTERVAL_MS) {
    Logger.i('AVSession', `throttled: sinceLast=${sinceLast}ms, merged into pending`);
    pendingState = { state, currentMs, durationMs, speed, loopMode };
    if (pendingStateTimer < 0) {
      pendingStateTimer = setTimeout((): void => {
        pendingStateTimer = -1;
        const p = pendingState;
        pendingState = null;
        if (p) doPushPlaybackState(p.state, p.currentMs, p.durationMs, p.speed, p.loopMode);
      }, MIN_STATE_REPORT_INTERVAL_MS - sinceLast);
    }
    return;
  }
  lastStateReportAt = now;

  lastPlaybackState = state;
  lastPositionMs = currentMs;
  lastSpeed = speed;
  lastDurationMs = durationMs;
  lastLoopMode = loopMode;
  lastReportedIsPlaying = state === avSession.PlaybackState.PLAYBACK_STATE_PLAY;

  session.setAVPlaybackState({
    position: { elapsedTime: currentMs, updateTime: Date.now() },
    speed: speed,
    state: state,
    duration: durationMs,
    loopMode: loopMode,
  })
    .then((): void => {
      Logger.i('AVSession', `playback state set: ${state === avSession.PlaybackState.PLAYBACK_STATE_PLAY ? 'PLAY' : 'PAUSE'} loop=${loopMode}`);
    })
    .catch((e: Error): void => {
      Logger.w('AVSession', `setAVPlaybackState failed: ${String(e)}`);
    });
}

// ────────────────────────────────────────────────────────────
// 后台长时任务（AUDIO_PLAYBACK）
// ────────────────────────────────────────────────────────────

/**
 * 申请 AUDIO_PLAYBACK 后台长时任务。
 * 必须在 module.json5 申请 ohos.permission.KEEP_BACKGROUND_RUNNING（ACL 受限权限，AGC 审批通过才能用）。
 * 系统可能在后台运行超过阈值后回收长时任务，每次进入播放应再调一次（参考官方 AudioCast 示例的实践）。
 * 函数设计为幂等：重复调用不抛错，重复申请会用同模式覆盖。
 */
async function startAudioBackgroundTask(): Promise<void> {
  if (!abilityContext) {
    Logger.w('AVSession', 'startAudioBackgroundTask skipped: abilityContext not set');
    return;
  }
  try {
    // 用 abilityInfo 拿 bundleName / abilityName，比 applicationInfo 更可靠（重构/分包不会断）
    const wa = await wantAgent.getWantAgent({
      wants: [{
        bundleName: abilityContext.abilityInfo.bundleName,
        abilityName: abilityContext.abilityInfo.name,
      }],
      operationType: wantAgent.OperationType.START_ABILITIES,
      requestCode: 0,
    });
    // API 18+：startBackgroundRunning(context, bgModes: string[], wantAgent): Promise<ContinuousTaskNotification>
    // bgModes 用字符串数组形式，'audioPlayback' 表示音视频后台播放。
    const result = await backgroundTaskManager.startBackgroundRunning(
      abilityContext,
      ['audioPlayback'],
      wa,
    );
    Logger.i(
      'AVSession',
      `background task started: notificationId=${result.notificationId}, slotType=${result.slotType}, contentType=${result.contentType}`,
    );
  } catch (e) {
    // ACL 受限权限未开通 / 系统限制时降级：仅靠 module.json5 的 backgroundModes 保住基础后台播放，
    // 通知栏播控可能不出现（典型症状：只剩"正在运行"普通通知、无媒体播控卡片），
    // 但播放本身不中断。要彻底解决需在 AGC 申请 KEEP_BACKGROUND_RUNNING。
    // 重复调用 / 任务已运行时这里也会被忽略，不影响流程。
    Logger.w('AVSession', `startBackgroundRunning failed (检查 AGC 是否已批准 KEEP_BACKGROUND_RUNNING): ${String(e)}`);
  }
}

function stopAudioBackgroundTask(): void {
  if (!abilityContext) return;
  backgroundTaskManager.stopBackgroundRunning(abilityContext).catch((): void => undefined);
}

// ────────────────────────────────────────────────────────────
// wantAgent：点击通知栏播控卡片回跳
// ────────────────────────────────────────────────────────────

async function bindLaunchWantAgent(context: common.UIAbilityContext): Promise<void> {
  if (!session) return;
  try {
    // UPDATE_PRESENT_FLAG：Ability 已在栈顶时不重新拉起，避免从通知栏点回时把同一个
    // EntryAbility 推一个新页面实例出来（对齐官方 AudioCast 示例的 wantAgentFlags 写法）。
    const wa = await wantAgent.getWantAgent({
      wants: [{
        bundleName: context.abilityInfo.bundleName,
        abilityName: context.abilityInfo.name,
      }],
      operationType: wantAgent.OperationType.START_ABILITIES,
      requestCode: 0,
      wantAgentFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG],
    });
    await session.setLaunchAbility(wa);
  } catch (e) {
    Logger.w('AVSession', `setLaunchAbility: ${String(e)}`);
  }
}

// ────────────────────────────────────────────────────────────
// 桌面歌词（系统歌词组件，API 23+）
// ────────────────────────────────────────────────────────────
//
// 正确姿势是接入 AVSession 系统歌词组件（官方指南 avsession-desktop-lyrics），
// 而不是自建 TYPE_FLOAT 悬浮窗——系统组件无需 SYSTEM_FLOAT_WINDOW 权限，
// 由系统播控中心承载窗口并按 AVPlaybackState 进度自动切换歌词行。
// 接入三要素：
//   1) AVMetadata.lyric 下发 LRC 原文（见 pushMetadata，官方要求必含 lyric 字段）；
//   2) enableDesktopLyric(true) 使能 + setDesktopLyricVisible 控制显隐；
//   3) 持续上报 AVPlaybackState（本项目已有），系统据此按进度切行。
// 注意：系统组件暂不支持应用自定义样式（字号/颜色/描边由系统管理）。

/** 能力检测结果缓存（仅检测一次，进程内不变）。 */
let desktopLyricSupported: boolean = false;
let desktopLyricSupportChecked: boolean = false;
/** install 阶段会话未激活导致恢复失败时置位，activate 完成后重试。 */
let pendingDesktopLyricRestore: boolean = false;

/** 系统/设备是否支持桌面歌词组件（avSession 模块级 API，API 23+）。 */
export async function isDesktopLyricSupported(): Promise<boolean> {
  if (desktopLyricSupportChecked) return desktopLyricSupported;
  try {
    desktopLyricSupported = await avSession.isDesktopLyricSupported();
  } catch (e) {
    // API 23 以下的系统没有这个接口，调用直接抛错 → 视为不支持
    desktopLyricSupported = false;
    Logger.w('AVSession', `isDesktopLyricSupported: ${String(e)}`);
  }
  desktopLyricSupportChecked = true;
  Logger.i('AVSession', `desktop lyric supported: ${desktopLyricSupported}`);
  return desktopLyricSupported;
}

/**
 * 使能/关闭桌面歌词并同步可见性。返回 false 表示失败（不支持 / 会话不存在 / 系统异常），
 * 调用方（SettingsPage）据此回弹开关并 toast，不落盘设置。
 */
export async function setDesktopLyricEnabled(enabled: boolean): Promise<boolean> {
  if (!session) return false;
  if (enabled && !(await isDesktopLyricSupported())) return false;
  try {
    // 关闭时先隐藏再禁用；开启时先使能再显示（setDesktopLyricVisible 前置条件是已使能）
    if (!enabled) {
      await session.setDesktopLyricVisible(false).catch((): void => undefined);
      await session.enableDesktopLyric(false);
    } else {
      await session.enableDesktopLyric(true);
      await session.setDesktopLyricVisible(true);
    }
    Logger.i('AVSession', `desktop lyric enabled=${enabled}`);
    return true;
  } catch (e) {
    Logger.w('AVSession', `setDesktopLyricEnabled(${enabled}): ${String(e)}`);
    return false;
  }
}

/**
 * install 时初始化：能力检测 → 绑定系统侧状态监听 → 按用户设置恢复。
 * AppStorage('desktopLyricsEnabled') 由 EntryAbility.initialize() 从 kvStore 恢复，
 * 本函数在 installAVSessionService 末尾调用，时序上保证 AppStorage 已就绪。
 */
async function initDesktopLyric(): Promise<void> {
  if (!(await isDesktopLyricSupported())) return;
  bindDesktopLyricListeners();
  if (AppStorage.get<boolean>('desktopLyricsEnabled') === true) {
    const ok = await setDesktopLyricEnabled(true);
    // 会话尚未 activate 时使能可能失败，置位等首次 activate 后重试
    if (!ok) pendingDesktopLyricRestore = true;
  }
}

/**
 * 监听系统侧歌词组件状态变化，同步应用内开关（官方指南要求应用 UI 与系统状态一致）。
 * 典型场景：用户在桌面歌词窗口上直接关闭/锁定歌词。
 */
function bindDesktopLyricListeners(): void {
  if (!session) return;
  try {
    session.onDesktopLyricVisibilityChanged((visible: boolean): void => {
      Logger.i('AVSession', `desktop lyric visibility changed: ${visible}`);
      // 系统侧关闭视为用户意图，回写设置（AppStorage 驱动 SettingsPage 开关回弹，kvStore 落盘）。
      // 应用自身调 setDesktopLyricVisible 也会触发本回调，写入同值，幂等无副作用。
      AppStorage.setOrCreate<boolean>('desktopLyricsEnabled', visible);
      kvStore.set('desktopLyricsEnabled', visible ? 'true' : 'false').catch((): void => undefined);
    });
    session.onDesktopLyricStateChanged((state: avSession.DesktopLyricState): void => {
      // 锁定状态目前仅记录日志（系统组件上用户可自行锁定/解锁，应用侧无对应设置项）
      Logger.i('AVSession', `desktop lyric locked: ${state.isLocked}`);
    });
  } catch (e) {
    Logger.w('AVSession', `bindDesktopLyricListeners: ${String(e)}`);
  }
}

// ────────────────────────────────────────────────────────────
// 封面下载 → PixelMap
// ────────────────────────────────────────────────────────────

async function fetchCoverPixelMap(url: string): Promise<image.PixelMap> {
  const req = http.createHttp();
  try {
    const resp = await req.request(url, {
      method: http.RequestMethod.GET,
      expectDataType: http.HttpDataType.ARRAY_BUFFER,
      connectTimeout: 10000,
      readTimeout: 10000,
    });
    if (resp.responseCode !== 200) {
      throw new Error(`HTTP ${resp.responseCode}`);
    }
    const buf = resp.result as ArrayBuffer;
    const source = image.createImageSource(buf);
    const pm = await source.createPixelMap();
    source.release();
    return pm;
  } finally {
    req.destroy();
  }
}
