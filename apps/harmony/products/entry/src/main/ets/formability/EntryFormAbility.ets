import FormExtensionAbility from '@ohos.app.form.FormExtensionAbility';
import formBindingData from '@ohos.app.form.formBindingData';
import formProvider from '@ohos.app.form.formProvider';
import formInfo from '@ohos.app.form.formInfo';
import Want from '@ohos.app.ability.Want';
import fs from '@ohos.file.fs';
import { util } from '@kit.ArkTS';
import { Logger } from 'audiodock_common';
import { kvStore } from 'features_storage';
import { httpClient, plusApi, setPlusAuthToken } from 'features_network';
import { authStore } from '../context/AuthStore';
import { widgetBridge } from '../services/WidgetBridge';
import { widgetCommandHandler } from '../services/WidgetCommandHandler';
import { WidgetCoverResolver } from '../widgets/WidgetCover';
import {
  HistorySnapshot, LatestSnapshot, NowPlayingSnapshot, PlaylistsSnapshot,
  VipSnapshot, WidgetCommandAction, WidgetKind, WIDGET_KV_KEYS,
} from '../models/WidgetData';

interface FormIdsBundle {
  ids: string[];
}

/** playerStore.persistState() 写入 playbackState_MUSIC 的持久化结构（子集，只取卡片需要的字段） */
interface PersistedTrackLite {
  id?: string;
  title?: string;
  artist?: string;
  coverUrl?: string;
}

interface PersistedPlaybackState {
  queue?: PersistedTrackLite[];
  currentIndex?: number;
  playMode?: string;
}

const TAG = 'EntryFormAbility';

/**
 * 桌面小部件 Ability（对齐 iOS AudioDockWidgetBundle）。
 *
 * - 一个 Ability 管 4 种卡片，通过 form_config.json 注册的不同 formName 区分
 * - onAddForm：返回 FormBindingData 首屏（空骨架），异步注册 formName→formId + 加载真实数据
 * - onUpdateForm：定时刷新，异步重新读 KV + updateForm
 * - onFormEvent：message 事件，message 字符串就是 action 名（卡片用 message 事件简化为纯字符串）
 *
 * 注：FormExtensionAbility 三个回调都必须同步签名（onAddForm 同步返回 FormBindingData，
 *    onUpdateForm/onFormEvent 同步 void），async 逻辑走 fire-and-forget。
 */
export default class EntryFormAbility extends FormExtensionAbility {
  /** 本地已 init 标志，避免 FormExtensionAbility 重复初始化 KV */
  private static kvInited: boolean = false;

  onCreate(want: Want): void {
    Logger.i(TAG, 'onCreate');
    this.ensureKvAndHttpReady().catch((): void => undefined);
  }

  onAddForm(want: Want): formBindingData.FormBindingData {
    const params = want.parameters ?? {};
    // ⚠️ formId 的 key 是 formInfo.FormParam.IDENTITY_KEY = "ohos.extra.param.key.form_identity"，
    // 不是 "ohos.extra.param.key.form_id"。用错 key 会拿到空字符串 → updateForm 报
    // "The formId is invalid" → 卡片永远停在首屏骨架（「未在播放」）。
    const formId = EntryFormAbility.readFormId(params);
    const formName = String(params[formInfo.FormParam.NAME_KEY] ?? '');
    // ⚠️ dimension 传的是 FormDimension 数字枚举（Dimension_2_2 = 2 / Dimension_4_4 = 4），
    // 不是 "2*2" 这种字符串。不归一化的话卡片里的 formDimension === '4*4' 判断恒为假，
    // 所有尺寸都会错渲染成 2x2 布局。
    const formDimension = EntryFormAbility.normalizeDimension(params[formInfo.FormParam.DIMENSION_KEY]);
    Logger.i(TAG, `onAddForm kind=${formName} id=${formId} dimension=${formDimension}`);
    // 异步：注册 formId + 加载真实数据 + updateForm
    this.afterAddForm(formName, formId, formDimension).catch((): void => undefined);
    // 同步：先返回空骨架让卡片立刻显示
    const data = this.emptySnapshotForKind(formName as WidgetKind, formDimension);
    return formBindingData.createFormBindingData(data as object);
  }

  /**
   * 把 FormDimension 数字枚举归一化成 "2*2" / "4*4" 这类字符串。
   * 枚举：Dimension_1_2=1, Dimension_2_2=2, Dimension_2_4=3, Dimension_4_4=4, Dimension_2_1=5
   */
  private static normalizeDimension(raw: Object | undefined): string {
    const s: string = raw === undefined || raw === null ? '' : String(raw);
    switch (s) {
      case '1': return '1*2';
      case '2': return '2*2';
      case '3': return '2*4';
      case '4': return '4*4';
      case '5': return '2*1';
      default: break;
    }
    // 已经是 "2*2" 格式的直接返回；取不到时按 form_config.json 的 defaultDimension 回落
    return s === '' ? '2*2' : s;
  }

  /**
   * 从 want.parameters 提取 formId，多 key 兜底。
   * 官方常量 formInfo.FormParam.IDENTITY_KEY = "ohos.extra.param.key.form_identity"；
   * 历史代码误用 "ohos.extra.param.key.form_id"（不存在的 key，恒为空），这里保留兜底但优先官方常量。
   */
  private static readFormId(params: Record<string, Object>): string {
    const candidates: string[] = [
      formInfo.FormParam.IDENTITY_KEY,
      'ohos.extra.param.key.form_id',
      'formId',
    ];
    for (let i = 0; i < candidates.length; i++) {
      const v = params[candidates[i]];
      if (v === undefined || v === null) continue;
      const s = String(v);
      if (s !== '' && s !== 'undefined' && s !== 'null') return s;
    }
    return '';
  }

  /**
   * onAddForm 后异步：注册 formName→formId，加载真实 KV 数据，推送给卡片。
   */
  private async afterAddForm(formName: string, formId: string, formDimension: string): Promise<void> {
    await this.ensureKvAndHttpReady();
    await widgetBridge.registerForm(formName, formId, formDimension);
    await this.pushSnapshot(formId, formName as WidgetKind, formDimension);
  }

  onUpdateForm(formId: string): void {
    Logger.i(TAG, `onUpdateForm formId=${formId}`);
    this.refreshOneForm(formId).catch((): void => undefined);
  }

  /**
   * 从 getFormsInfo 反推 formName（API 24 FormInfo 没有 formId），用 bundleName+moduleName
   * 过滤本应用的所有卡片，每个都 refresh。
   * 注意：同一 formName 可能有多个 formId（用户添加多张同名卡片），
   * 但 onUpdateForm 只传单个 formId，我们遍历 FormInfo 后用 moduleName 筛选再 update。
   */
  private async refreshOneForm(formId: string): Promise<void> {
    await this.ensureKvAndHttpReady();
    // 主 App 进程可能刚写过数据，先丢弃本进程缓存重载，否则读到的是陈旧值
    await kvStore.pull();
    // 直接从 kvStore 的 formId→formName 反向索引查（比遍历 getFormsInfo 可靠，
    // 避免系统 formName 和 getFormsInfo 返回的 name 不一致的问题）
    const formName = await kvStore.get(`widget_form_name_${formId}`);
    if (!formName) {
      Logger.w(TAG, `refreshOneForm ${formId} unknown formName（kvStore 无反向索引）`);
      return;
    }
    const dimension = await kvStore.get(`widget_form_dimension_${formId}`) ?? '2*2';
    await this.pushSnapshot(formId, formName as WidgetKind, dimension);
  }

  private async pushSnapshot(formId: string, kind: WidgetKind, formDimension: string): Promise<void> {
    const data = await this.loadSnapshotForKind(kind, formDimension);
    const binding = formBindingData.createFormBindingData(data as object);
    try {
      await formProvider.updateForm(formId, binding);
      Logger.i(TAG, `pushSnapshot ${formId} kind=${kind} dim=${formDimension}`);
    } catch (e) {
      Logger.w(TAG, `pushSnapshot ${formId}: ${String(e)}`);
    }
  }

  onFormEvent(formId: string, message: string): void {
    Logger.i(TAG, `onFormEvent formId=${formId} message=${message}`);
    // 卡片 postCardAction(action='message', params={message: 'play'}) → message 就是 action 字符串
    // 带 id 的指令用 'play_track:trackId' 这种紧凑格式
    const sep = message.indexOf(':');
    let action: string;
    let id: string;
    if (sep >= 0) {
      action = message.substring(0, sep);
      id = message.substring(sep + 1);
    } else {
      action = message;
      id = '';
    }
    const payload: Record<string, string> = {};
    if (id) payload['id'] = id;
    const cmd: WidgetCommandAction = {
      action,
      payload,
    };
    widgetCommandHandler.handle(cmd).catch((): void => undefined);
  }

  onRemoveForm(formId: string): void {
    Logger.i(TAG, `onRemoveForm formId=${formId}`);
    this.removeFormFromIndex(formId).catch((): void => undefined);
  }

  private async removeFormFromIndex(formId: string): Promise<void> {
    const names = [WidgetKind.PLAYER, WidgetKind.PLAYLIST, WidgetKind.HISTORY, WidgetKind.LATEST];
    for (let i = 0; i < names.length; i++) {
      await widgetBridge.unregisterForm(names[i], formId);
    }
  }

  private async ensureKvAndHttpReady(): Promise<void> {
    if (EntryFormAbility.kvInited) return;
    try {
      await kvStore.init(this.context);
      EntryFormAbility.kvInited = true;
    } catch (e) {
      Logger.w(TAG, `kvStore init: ${String(e)}`);
      return;
    }
    try {
      const stored = await kvStore.get('serverAddress');
      if (stored) httpClient.setBaseURL(stored);
      // 卡片进程是独立 process，WidgetCoverResolver.baseUrl 是模块级变量，
      // 主 App 进程的赋值在这里看不到，必须自己从 kvStore 读 serverAddress 初始化，
      // 否则列表卡片的相对路径封面（/covers/xxx）解析不出来，全显示占位音符。
      if (stored) WidgetCoverResolver.baseUrl = stored;
      const token = await kvStore.get(`token_${stored ?? ''}`);
      if (token) httpClient.setAuthToken(token);
      // 同步 plus token（卡片进程读 VIP 需要）
      const plusToken = await kvStore.get('plus_token');
      if (plusToken) setPlusAuthToken(plusToken);
      // 卡片进程是独立 process，AuthStore 默认 user=null；必须从 KV 加载登录态，
      // 否则 readIsLocked() 走「缓存无效 → 实时调 plusApi」分支时拿不到 user.id。
      await authStore.loadFromStorage();
    } catch (e) {
      Logger.w(TAG, `httpClient init: ${String(e)}`);
    }
  }

  /**
   * 判定是否应该显示 VIP 锁定页：
   * - 优先读 WidgetBridge.syncVip 写入的 widget_vip（updatedAt > 0 表示已同步）
   * - 兜底：直接调 plusApi.getVipStatus（卡片进程冷启动时主 App 未跑过 syncVip）
   * - 未登录 / API 失败 → 不锁定（避免误伤正常体验）
   */
  private async readIsLocked(): Promise<boolean> {
    try {
      const cached = await kvStore.getJSON<VipSnapshot>(WIDGET_KV_KEYS.vip);
      if (cached && cached.updatedAt > 0) {
        return !cached.isVip;
      }
      const plusUserId = await kvStore.get('plus_user_id');
      if (!plusUserId) return false;
      const status = await plusApi.getVipStatus(plusUserId);
      return !status.isVip;
    } catch (e) {
      Logger.w(TAG, `readIsLocked: ${String(e)}`);
      return false;
    }
  }

  /**
   * 空骨架（同步返回，onAddForm 用）
   */
  private emptySnapshotForKind(kind: WidgetKind, formDimension: string): Record<string, string | number | boolean | object | null> {
    const out: Record<string, string | number | boolean | object | null> = {};
    out['formDimension'] = formDimension;
    out['formName'] = String(kind);
    if (kind === WidgetKind.PLAYER) {
      out['title'] = '';
      out['artist'] = '';
      out['cover'] = '';
      out['isPlaying'] = false;
      out['playMode'] = 'SEQUENCE';
      out['isLiked'] = false;
      out['colorPrimary'] = '#1a1a2e';
      out['colorSecondary'] = '#16213e';
      out['updatedAt'] = 0;
    } else if (kind === WidgetKind.PLAYLIST || kind === WidgetKind.LATEST) {
      out['items'] = [];
      out['updatedAt'] = 0;
    } else if (kind === WidgetKind.HISTORY) {
      out['nowPlaying'] = null;
      out['items'] = [];
      out['updatedAt'] = 0;
    }
    return out;
  }

  /**
   * 卡片数据骨架：默认空 snapshot + formDimension/formName 元字段 + isLocked（VIP 判定）。
   */
  private async loadSnapshotForKind(
    kind: WidgetKind,
    formDimension: string,
  ): Promise<Record<string, string | number | boolean | object | null>> {
    // ⚠️ 跨进程关键：preferences 每进程一份内存缓存实例。FormExtensionAbility 是长生命周期单例，
    // 首次 init 后实例就固定了；主 App 进程之后 flush 的播放状态/VIP 状态本进程读不到，
    // 会一直返回首次缓存的 null → 卡片永远显示「未在播放」。
    // 所以每次加载快照前先 pull() 丢弃缓存从磁盘重载。
    await kvStore.pull();
    const out: Record<string, string | number | boolean | object | null> = {};
    out['formDimension'] = formDimension;
    out['formName'] = String(kind);
    // VIP 锁定判定（非会员 → isLocked = true，卡片渲染 LockedCard）
    out['isLocked'] = await this.readIsLocked();
    if (out['isLocked'] === true) return out;
    switch (kind) {
      case WidgetKind.PLAYER: {
        const np = await kvStore.getJSON<NowPlayingSnapshot>(WIDGET_KV_KEYS.nowPlaying);
        // 如果 kvStore 里没有 widget_now_playing（主 App 没启动过或还没播放），
        // 主动从 playbackState_MUSIC 恢复上次的播放状态，避免卡片永远显示「未在播放」
        let v = np ?? this.emptyNowPlaying();
        if (v.updatedAt === 0) {
          v = await this.restoreNowPlayingFromPersistedState();
        }
        out['title'] = v.title;
        out['artist'] = v.artist;
        out['cover'] = v.cover;
        out['isPlaying'] = v.isPlaying;
        out['playMode'] = v.playMode;
        out['isLiked'] = v.isLiked;
        out['colorPrimary'] = v.colorPrimary;
        out['colorSecondary'] = v.colorSecondary;
        out['updatedAt'] = v.updatedAt;
        break;
      }
      case WidgetKind.PLAYLIST: {
        const pl = await kvStore.getJSON<PlaylistsSnapshot>(WIDGET_KV_KEYS.playlists);
        const v = pl ?? { items: [], isPlaying: false, updatedAt: 0 };
        out['items'] = v.items;
        out['isPlaying'] = v.isPlaying;
        out['updatedAt'] = v.updatedAt;
        break;
      }
      case WidgetKind.HISTORY: {
        const hs = await kvStore.getJSON<HistorySnapshot>(WIDGET_KV_KEYS.history);
        const v = hs ?? { nowPlaying: null, items: [], updatedAt: 0 };
        out['nowPlaying'] = v.nowPlaying;
        out['items'] = v.items;
        out['updatedAt'] = v.updatedAt;
        break;
      }
      case WidgetKind.LATEST: {
        const lt = await kvStore.getJSON<LatestSnapshot>(WIDGET_KV_KEYS.latest);
        const v = lt ?? { items: [], isPlaying: false, updatedAt: 0 };
        out['items'] = v.items;
        out['isPlaying'] = v.isPlaying;
        out['updatedAt'] = v.updatedAt;
        break;
      }
      default:
        Logger.w(TAG, `unknown kind: ${kind}`);
    }
    return out;
  }

  private emptyNowPlaying(): NowPlayingSnapshot {
    return {
      title: '', artist: '', cover: '',
      colorPrimary: '#1a1a2e', colorSecondary: '#16213e',
      isPlaying: false, playMode: 'SEQUENCE', isLiked: false,
      updatedAt: 0,
    };
  }

  /**
   * 从主 App 的持久化播放状态（playbackState_MUSIC）恢复上次的播放快照。
   *
   * 场景：主 App 没启动过（或启动了但还没播放），kvStore 里 widget_now_playing 是空的，
   * 卡片永远显示「未在播放」。这里主动读 playerStore.persistState() 写入的 playbackState_MUSIC，
   * 把上次的队列 + 当前索引恢复出来，让卡片至少能显示上次的歌曲信息。
   *
   * 注意：这里恢复的是「上次的播放状态」，不是「当前正在播放」。
   * isPlaying 恒为 false（因为主 App 没在跑），但 title/artist/cover 有值，
   * 卡片会显示歌曲信息 + 播放按钮（而不是「未在播放」占位）。
   */
  /**
   * 冷启动恢复时的封面。
   *
   * ⚠️ 卡片渲染跑在 **com.ohos.formrenderservice 进程**（不是本 App 进程），
   * `/data/storage/el2/base` 是按进程映射的沙箱视图，在 formrender 里指向它自己的目录，
   * 所以 file:// 本地路径卡片一律 accessSync 失败（日志 `resolve file miss`）。
   * 同理网络 URL 在卡片里也加载不了。
   * → **唯一可靠通道是 data: URI 内联 base64**（随 FormBindingData 一起跨进程传过去）。
   */
  private async resolveCoverForRestore(cachedCover: string, rawCover: string): Promise<string> {
    if (cachedCover !== '' && cachedCover.startsWith('data:')) return cachedCover;
    if (rawCover === '') return '';
    if (rawCover.startsWith('data:')) return rawCover;
    if (rawCover.startsWith('file://')) return rawCover;
    if (rawCover.startsWith('http')) return rawCover;
    if (WidgetCoverResolver.baseUrl !== '') {
      return `${WidgetCoverResolver.baseUrl.replace(/\/$/, '')}${rawCover.startsWith('/') ? '' : '/'}${rawCover}`;
    }
    return rawCover;
  }

  /** 目录是否存在（fs.accessSync 失败即不存在/无权限） */
  private dirExists(dir: string): boolean {
    try {
      return fs.accessSync(dir);
    } catch (e) {
      return false;
    }
  }

  /** 把 data:image/...;base64,... 转成 file:// 本地文件 */
  private async dataImageToFile(dataImage: string): Promise<string> {
    try {
      const commaIdx = dataImage.indexOf(',');
      if (commaIdx < 0) return '';
      const base64Str = dataImage.substring(commaIdx + 1);
      const helper = new util.Base64Helper();
      const bytes = helper.decodeSync(base64Str);
      if (bytes.length === 0) return '';
      const mime = dataImage.substring(5, commaIdx);
      const ext = mime.includes('webp') ? 'webp' : mime.includes('png') ? 'png' : 'jpg';
      const dir = `${this.context.filesDir}/widget_covers`;
      // ⚠️ fs.mkdirSync(dir, true) 在目录已存在时同样抛 "File exists"，必须先判断
      if (!this.dirExists(dir)) {
        try {
          fs.mkdirSync(dir, true);
        } catch (e) {
          if (!this.dirExists(dir)) {
            Logger.w(TAG, `dataImageToFile mkdir failed: ${String(e)}`);
            return '';
          }
        }
      }
      const path = `${dir}/restore_${Date.now()}.${ext}`;
      try {
        fs.unlinkSync(path);
      } catch (e) {
        // 文件不存在时忽略
      }
      const file = fs.openSync(path, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
      const clean = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      fs.writeSync(file.fd, clean);
      fs.closeSync(file);
      return `file://${path}`;
    } catch (e) {
      Logger.w(TAG, `dataImageToFile: ${String(e)}`);
      return '';
    }
  }

  private async restoreNowPlayingFromPersistedState(): Promise<NowPlayingSnapshot> {
    try {
      const raw = await kvStore.get('playbackState_MUSIC');
      if (!raw || raw.length === 0) return this.emptyNowPlaying();
      const parsed = JSON.parse(raw) as PersistedPlaybackState;
      const queue = parsed.queue ?? [];
      const idx = parsed.currentIndex ?? -1;
      if (queue.length === 0 || idx < 0 || idx >= queue.length) return this.emptyNowPlaying();
      const cur = queue[idx];
      // 封面优先读 WidgetBridge 缓存的 dataImage，转成 file:// 本地文件
      // （FormBindingData 对超长字符串有截断风险，file:// 路径只有几十个字符最可靠）
      const cachedCover = await kvStore.get('widget_now_playing_cover_cache');
      const rawCover = String(cur.coverUrl ?? '');
      const resolvedCover = await this.resolveCoverForRestore(cachedCover ?? '', rawCover);
      return {
        title: String(cur.title ?? ''),
        artist: String(cur.artist ?? ''),
        cover: resolvedCover,
        colorPrimary: '#3a3a5e',
        colorSecondary: '#222246',
        isPlaying: false, // 主 App 没在跑，不可能正在播放
        playMode: (parsed.playMode ?? 'SEQUENCE') as 'SEQUENCE' | 'LOOP_LIST' | 'LOOP_SINGLE' | 'SHUFFLE',
        isLiked: false,
        updatedAt: Date.now(),
      };
    } catch (e) {
      Logger.w(TAG, `restoreNowPlayingFromPersistedState: ${String(e)}`);
      return this.emptyNowPlaying();
    }
  }
}
