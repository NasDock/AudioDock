import formProvider from '@ohos.app.form.formProvider';
import formBindingData from '@ohos.app.form.formBindingData';
import { http } from '@kit.NetworkKit';
import fs from '@ohos.file.fs';
import { util } from '@kit.ArkTS';
import common from '@ohos.app.ability.common';
import { Logger } from 'audiodock_common';
import { kvStore } from 'features_storage';
import { httpClient } from 'features_network';
import { plusApi } from 'features_network';
import { userDataApi } from 'features_network';
import { trackApi } from 'features_network';
import { playlistApi } from 'features_network';
import type { TrackDto, PlaylistDto, TrackHistoryItem } from 'features_network';
import { likesHistory } from './LikesHistoryService';
import {
  HistorySnapshot, LatestSnapshot, NowPlayingSnapshot,
  PlaylistsSnapshot, VipSnapshot, WidgetKind,
  WIDGET_KV_KEYS,
} from '../models/WidgetData';
import { getImageUrl } from '../utils/image';
import { WidgetCoverResolver } from '../widgets/WidgetCover';

/**
 * playerStore 的最小视图契约（本地声明，避免 import PlayerStore 造成循环依赖）。
 * PlayerStore → WidgetBridge → PlayerStore 的环会让两个模块都加载失败，
 * 所以本模块一律用动态 import('../context/PlayerStore') 在运行时取。
 */
interface WidgetTrack {
  id: string;
  title: string;
  artist?: string;
  coverUrl?: string;
}

/** 播放模式（与 NowPlayingSnapshot.playMode 同构） */
type WidgetPlayMode = 'SEQUENCE' | 'LOOP_LIST' | 'LOOP_SINGLE' | 'SHUFFLE';

interface PlayerStateViewLite {
  queue: WidgetTrack[];
  currentIndex: number;
  isPlaying: boolean;
  playMode: WidgetPlayMode;
}

interface PlayerStoreLite {
  view(): PlayerStateViewLite;
  togglePlayMode(): void;
}

/**
 * 下载结果：字节 + 真实图片后缀。
 * ⚠️ ArkTS 严格模式禁止对象字面量类型（arkts-no-obj-literals-as-types），
 * 所以 Promise<{bytes: Uint8Array; ext: string}> 必须写成显式 interface。
 */
interface DownloadedImage {
  bytes: Uint8Array;
  ext: string;
}

/**
 * 主 App → 卡片数据推送（对齐 mobile WidgetBridge.swift）。
 *
 * - 播放状态由 PlayerStore.notify() → pushToWidget() → syncNowPlayingFromStore(view) 推
 * - 状态变化时同步 4 类数据到 kvStore（共享 preferences，FormExtensionAbility 直接读）
 * - 调 formProvider.updateForm 让已添加的卡片立刻重绘
 * - EntryAbility 启动时 refreshAll() 拉一次最新数据（VIP、歌单、历史、上新）
 *
 * ⚠️ 跨进程坑：preferences 是每进程一份内存缓存实例。主 App 进程和卡片进程各持一份，
 * 一方 flush 到磁盘后另一方仍返回旧缓存值。所以凡是读「可能被对方进程写入」的数据
 * （formId 注册表、播放状态），一律走 kvStore.getJSONFresh() 先 pull 再读。
 *
 * 容错：所有失败仅 Logger.w，不影响主 App 业务。
 */

const TAG = 'WidgetBridge';
/** 上新单曲数量（对齐 iOS LATEST_LIMIT = 5） */
const LATEST_LIMIT = 5;
/** 歌单卡片显示数量（对齐 iOS PLAYLIST_LIMIT = 3） */
const PLAYLIST_LIMIT = 3;
/** 历史卡片数量（对齐 iOS HISTORY_LIMIT = 3） */
const HISTORY_LIMIT = 3;
/**
 * 卡片封面 dataImage 上限（FormBindingData 字段有大小限制，实测 >80KB 的 base64
 * 会被系统丢弃导致卡片收不到）。封面统一压到 300px webp，基本 <20KB。
 */
const COVER_DATA_IMAGE_MAX_BYTES = 80 * 1024;
/**
 * 预取封面超时：网络不好时不能卡住 updateForm 主流程，
 * 超时后直接放弃 dataImage，退化为发网络 URL。
 */
/** 封面下载超时。4s 在外网下 300px 大图经常超时（实测 cover prefetch timeout），放宽到 8s。 */
const COVER_PREFETCH_TIMEOUT_MS = 8000;
/**
 * 卡片封面预取目录（主 App filesDir 下，FormExtensionAbility 同 UID 可读）。
 * 注意不是 fileCache 的 cache/ 目录 —— 那个目录会被「清理缓存」功能清空，
 * 卡片封面需要独立存放避免被误清。
 */
const WIDGET_COVER_DIR = 'widget_covers';
/**
 * 全局 formId 索引 key。
 * 兜底场景：widget_form_ids_${formName} 依赖卡片进程写入的 formName 与 WidgetKind 枚举字符串
 * 完全一致；一旦系统传的 formName 有出入（空串/别名），主 App 就一条都匹配不到。
 * 这里额外维护一个不依赖 formName 的全局列表，配合 formId→formName 反查做交叉兜底。
 */
const WIDGET_ALL_FORM_IDS = 'widget_all_form_ids';

/** 歌单卡片行数据 */
interface PlaylistRowDto {
  id: string;
  name: string;
  cover: string;
  trackCount: number;
}

/** 历史卡片行数据 */
interface HistoryRowDto {
  id: string;
  title: string;
  artist: string;
  cover: string;
}

/** 上新单曲行数据 */
interface LatestRowDto {
  id: string;
  title: string;
  artist: string;
  cover: string;
}

/** formName → formId[] 映射条目（持久化到 kvStore 让 EntryAbility 进程能读到） */
interface FormIdsBundle {
  ids: string[];
}

class WidgetBridgeImpl {
  private installed: boolean = false;
  private syncScheduled: boolean = false;
  /** 最近一次已预取封面的 key（url），避免每次 notify 都重新下载。 */
  private lastCoverKey: string = '';
  /** 最近一次预取出的本地文件路径 / dataImage。 */
  private lastCoverFile: string = '';
  private lastCoverDataImage: string = '';

  /** 运行时取 playerStore（动态 import 打破循环依赖） */
  private async getPlayerStore(): Promise<PlayerStoreLite | null> {
    try {
      const mod = await import('../context/PlayerStore');
      return mod.playerStore as PlayerStoreLite;
    } catch (e) {
      Logger.w(TAG, `import PlayerStore: ${String(e)}`);
      return null;
    }
  }

  /**
   * 安装订阅。需在 likesHistory 就绪后调用（EntryAbility.initialize 末尾）。
   *
   * 注意：这里不再 subscribe playerStore —— 那个订阅只在主 App 进程内有效，卡片进程收不到。
   * 播放状态推送改由 PlayerStore.notify() → pushToWidget() → syncNowPlayingFromStore() 驱动。
   */
  install(): void {
    if (this.installed) return;
    this.installed = true;
    likesHistory.on('trackLike', (): void => {
      this.scheduleSyncNowPlaying();
    });
    Logger.i(TAG, 'installed');
  }

  /**
   * 启动时拉取一次全量数据（VIP、歌单、历史、上新），不含播放状态（播放状态等下一次 subscribe 触发）。
   * 拉 VIP 需要 plus token，所以放在 httpClient / authStore 初始化之后。
   */
  async refreshAll(): Promise<void> {
    await Promise.all([
      this.syncVip(),
      this.syncPlaylists(),
      this.syncHistory(),
      this.syncLatest(),
    ]);
    this.scheduleSyncNowPlaying();
  }

  // ─── 实时订阅：now-playing 同步 ────────────────────────────────────────

  /**
   * 1000ms 合并触发（public，供 PlayerStore.notify() 高频路径调用，
   * 避免进度 tick（~50ms 一次）把 formProvider.updateForm 打爆。
   * 系统 hilog 报过 isReportOverSize,checkFail，说明 300ms 还是太频繁。
   */
  scheduleSyncNowPlaying(): void {
    if (this.syncScheduled) return;
    this.syncScheduled = true;
    setTimeout((): void => {
      this.syncScheduled = false;
      this.syncNowPlaying().catch((e: Error): void => {
        Logger.w(TAG, `syncNowPlaying: ${e.message}`);
      });
    }, 1000);
  }

  async syncNowPlaying(): Promise<void> {
    const store = await this.getPlayerStore();
    if (!store) return;
    const view = store.view();
    const cur: WidgetTrack | undefined = view.queue[view.currentIndex];
    Logger.i(TAG, `syncNowPlaying isPlaying=${view.isPlaying} idx=${view.currentIndex} queue=${view.queue.length}`);
    if (!cur) {
      // 清空状态：still 推一次让卡片显示「未在播放」
      const empty: NowPlayingSnapshot = {
        title: '', artist: '', cover: '',
        colorPrimary: '#1a1a2e', colorSecondary: '#16213e',
        isPlaying: false, playMode: view.playMode, isLiked: false,
        updatedAt: Date.now(),
      };
      this.lastCoverKey = '';
      this.lastCoverFile = '';
      this.lastCoverDataImage = '';
      await this.writeAndPushNowPlaying(empty);
      await this.syncHistoryNowPlaying(empty);
      await this.syncListCardPlaybackState(false);
      return;
    }
    const isLiked = cur.id ? await likesHistory.isTrackLiked(cur.id) : false;
    // 封面预取（对齐官方卡片最佳实践「进程侧预取，卡片直读本地」）：
    // 卡片进程对网络 URL 的 Image 渲染不稳定，主 App 侧先把封面拉成
    // file:// 缓存 + dataImage 内联，卡片直接渲染本地资源。
    const coverSource = cur.coverUrl ?? '';
    if (coverSource !== this.lastCoverKey) {
      await this.prefetchCover(coverSource);
      this.lastCoverKey = coverSource;
    }
    const snap: NowPlayingSnapshot = {
      title: cur.title ?? '',
      artist: cur.artist ?? '',
      // data: URI 优先（卡片渲染在 formrenderservice 进程，file:// 沙箱不通用，
      // 网络 URL 又加载不了，data URI 是唯一可靠通道），file:// 仅作兜底
      cover: this.lastCoverDataImage !== '' ? this.lastCoverDataImage
        : this.lastCoverFile !== '' ? this.lastCoverFile
        : coverSource,
      colorPrimary: '#3a3a5e',
      colorSecondary: '#222246',
      isPlaying: view.isPlaying,
      playMode: view.playMode,
      isLiked,
      updatedAt: Date.now(),
    };
    await this.writeAndPushNowPlaying(snap);
    await this.syncHistoryNowPlaying(snap);
    await this.syncListCardPlaybackState(snap.isPlaying);
  }

  // ─── 封面预取（主 App 侧下载 → 本地 file + dataImage）─────────────────────

  /**
   * 把封面（相对路径或外链）拉成本地缓存 + base64 dataImage。
   * 成功时 lastCoverFile/lastCoverDataImage 更新；失败保留旧值并清空，走网络 URL 兜底。
   */
  private async prefetchCover(coverSource: string): Promise<void> {
    this.lastCoverFile = '';
    this.lastCoverDataImage = '';
    if (coverSource === '') return;
    try {
      const absoluteUrl: string = coverSource.startsWith('http://') || coverSource.startsWith('https://')
        ? coverSource
        : getImageUrl(coverSource, 300);
      // 同步 baseUrl 给卡片侧 resolver（WidgetCover/WidgetBackground 兜底用），
      // 卡片进程不 import features_network，只能靠这个模块级变量补全相对路径。
      WidgetCoverResolver.baseUrl = httpClient.getBaseURL();
      const timeout: Promise<DownloadedImage> = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('cover prefetch timeout')), COVER_PREFETCH_TIMEOUT_MS);
      });
      const result = await Promise.race([
        this.downloadBytes(absoluteUrl),
        timeout,
      ]);
      if (result.bytes.length === 0) return;
      const filePath: string = await this.writeCoverToDisk(absoluteUrl, result.bytes, result.ext);
      if (filePath !== '') this.lastCoverFile = `file://${filePath}`;
      if (result.bytes.length <= COVER_DATA_IMAGE_MAX_BYTES) {
        const mime = result.ext === 'webp' ? 'image/webp' : result.ext === 'png' ? 'image/png' : 'image/jpeg';
        this.lastCoverDataImage = `data:${mime};base64,${this.uint8ToBase64(result.bytes)}`;
      }
      Logger.i(TAG, `prefetchCover ok file=${this.lastCoverFile !== ''} dataImage=${this.lastCoverDataImage.length}B`);
    } catch (e) {
      Logger.w(TAG, `prefetchCover: ${String(e)}`);
    }
  }

  /** 用 @kit.NetworkKit http 拉二进制（绕开 httpClient 的 JSON 解析管道）。
   * 返回 {bytes, ext}——ext 从 Content-Type 拿真实格式，不再猜 URL 后缀。
   */
  private async downloadBytes(url: string): Promise<DownloadedImage> {
    const httpReq = http.createHttp();
    try {
      const resp = await httpReq.request(url, {
        method: http.RequestMethod.GET,
        expectDataType: http.HttpDataType.ARRAY_BUFFER,
        readTimeout: COVER_PREFETCH_TIMEOUT_MS,
        connectTimeout: COVER_PREFETCH_TIMEOUT_MS,
      });
      if (resp.responseCode !== 200) {
        Logger.w(TAG, `downloadBytes status=${resp.responseCode} url=${url}`);
        return { bytes: new Uint8Array(0), ext: '' };
      }
      const buf = resp.result as ArrayBuffer;
      const contentType = String(resp.header?.['content-type'] ?? resp.header?.['Content-Type'] ?? '');
      const ext = contentType.includes('webp') ? 'webp'
        : contentType.includes('png') ? 'png'
        : contentType.includes('gif') ? 'gif'
        : 'jpg';
      return { bytes: new Uint8Array(buf), ext };
    } finally {
      httpReq.destroy();
    }
  }

  /**
   * 列表封面统一下载 → 转 `data:` URI 内联 base64。
   *
   * ⚠️⚠️ 卡片渲染跑在 **com.ohos.formrenderservice 进程**（设备日志里 domain 就是它），
   * 不是本 App 进程。三种图片通道实测结果：
   *   1. 网络 URL —— 卡片里加载不了，全部不显示
   *   2. file://  —— `/data/storage/el2/base` 是按**进程**映射的沙箱视图，
   *                  formrender 里指向它自己的目录 → `resolve file miss`
   *   3. `data:` URI —— 随 FormBindingData 一起跨进程传，唯一可靠 ✅
   * 所以列表封面和正在播放封面都走 data URI，落盘缓存只作本地副产品。
   *
   * 列表封面用 96px 档（small 40vp × 2 ≈ 96px，在 optimize 档位表内），每张 1~3KB，
   * 5 条列表 + 正在播放（300px ≈ 15KB base64）远低于 FormBindingData 上限。
   *
   * 下载失败或超限时返回 ''（卡片显示占位音符，不影响列表其他行）。
   */
  private async resolveCoverToFile(cover: string): Promise<string> {
    if (cover === '') return '';
    if (cover.startsWith('data:')) return cover;
    return this.resolveCoverToDataImage(cover, 96);
  }

  /** 下载封面并转成 `data:image/xxx;base64,...`（失败返回 ''）。 */
  private async resolveCoverToDataImage(cover: string, width: number): Promise<string> {
    if (cover === '') return '';
    if (cover.startsWith('data:')) return cover;
    // 外链封面（Subsonic / Emby 等）也要下载，卡片进程加载不了 http URL
    const absoluteUrl = cover.startsWith('http://') || cover.startsWith('https://')
      ? cover
      : getImageUrl(cover, width);
    try {
      WidgetCoverResolver.baseUrl = httpClient.getBaseURL();
      const timeout: Promise<DownloadedImage> = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('list cover prefetch timeout')), COVER_PREFETCH_TIMEOUT_MS);
      });
      const result = await Promise.race([
        this.downloadBytes(absoluteUrl),
        timeout,
      ]);
      if (result.bytes.length === 0) return '';
      if (result.bytes.length > COVER_DATA_IMAGE_MAX_BYTES) return '';
      const mime = result.ext === 'webp' ? 'image/webp' : result.ext === 'png' ? 'image/png' : 'image/jpeg';
      return `data:${mime};base64,${this.uint8ToBase64(result.bytes)}`;
    } catch (e) {
      Logger.w(TAG, `resolveCoverToDataImage: ${String(e)}`);
      return '';
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
      const ctx = AppStorage.get<common.UIAbilityContext>('abilityContext');
      if (!ctx) return '';
      const dir = `${ctx.filesDir}/${WIDGET_COVER_DIR}`;
      if (!this.ensureDir(dir)) return '';
      const path = `${dir}/data_${this.simpleHash(dataImage)}.${ext}`;
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

  /**
   * 确保目录存在。
   *
   * ⚠️ 巨坑：`fs.mkdirSync(dir, true)` 在**目录已存在**时同样抛 `File exists`（EEXIST），
   * 不是「存在即返回」。这会让第二次及以后的封面写入全部失败，卡片永远显示占位音符
   * （设备日志里表现为满屏 `writeCoverToDisk: Error: File exists`）。
   * 所以必须先 accessSync 判断，且 mkdir 抛错后再 accessSync 校验一次（并发兜底）。
   */
  private ensureDir(dir: string): boolean {
    try {
      if (fs.accessSync(dir)) return true;
    } catch (e) {
      // 目录不存在，往下创建
    }
    try {
      fs.mkdirSync(dir, true);
      return true;
    } catch (e) {
      try {
        if (fs.accessSync(dir)) return true;
      } catch (e2) {
        Logger.w(TAG, `ensureDir failed dir=${dir}: ${String(e)}`);
        return false;
      }
      Logger.w(TAG, `ensureDir mkdir=${String(e)}`);
      return false;
    }
  }

  /** 把封面字节写进 filesDir/widget_covers，返回绝对路径（失败返回 ''）。 */
  private async writeCoverToDisk(url: string, bytes: Uint8Array, ext: string = 'jpg'): Promise<string> {
    try {
      const ctx = AppStorage.get<common.UIAbilityContext>('abilityContext');
      if (!ctx) {
        Logger.w(TAG, 'writeCoverToDisk: abilityContext 未注入');
        return '';
      }
      const dir = `${ctx.filesDir}/${WIDGET_COVER_DIR}`;
      if (!this.ensureDir(dir)) return '';
      const hash: string = `${this.simpleHash(url)}`;
      const safeExt = ext !== '' ? ext : (url.includes('fmt=webp') || url.endsWith('.webp') ? 'webp' : 'jpg');
      const path = `${dir}/${hash}.${safeExt}`;
      // 先删再写：避免同名文件残留/openSync 在部分机型上报 EEXIST
      try {
        fs.unlinkSync(path);
      } catch (e) {
        // 文件不存在时忽略
      }
      const file = fs.openSync(path, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
      const clean = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      fs.writeSync(file.fd, clean);
      fs.closeSync(file);
      const stat = fs.statSync(path);
      if (stat.size === 0) {
        Logger.w(TAG, `writeCoverToDisk: empty file ${path}`);
        return '';
      }
      return path;
    } catch (e) {
      Logger.w(TAG, `writeCoverToDisk: ${String(e)}`);
      return '';
    }
  }

  /** 简单 32 位字符串 hash（够用作本地文件名，不需要加密强度）。 */
  private simpleHash(s: string): number {
    let h: number = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return h < 0 ? -h : h;
  }

  /** Uint8Array → base64（用 @kit.ArkTS 的 util.Base64Helper，避免手写表）。 */
  private uint8ToBase64(bytes: Uint8Array): string {
    const helper = new util.Base64Helper();
    const uint8 = new Uint8Array(bytes);
    return helper.encodeToStringSync(uint8);
  }

  // ─── 启动时拉取：VIP、歌单、历史、上新 ────────────────────────────────

  private async syncVip(): Promise<void> {
    try {
      // plus VIP 系统有独立用户 ID（与 authStore.user.id 不同），见 mobile _layout.tsx syncVipState
      const userId = await kvStore.get('plus_user_id');
      if (!userId) {
        // 未登录 plus 会员系统时不写 KV：让 EntryFormAbility.readIsLocked 走「缓存无效 → 不锁定」分支，
        // 避免登录态恢复前把 isVip=false 当作"已同步结果"缓存，导致 VIP 也被错误锁定。
        return;
      }
      const status = await plusApi.getVipStatus(userId);
      const snap: VipSnapshot = {
        isVip: !!status.isVip,
        expiresAt: status.expiresAt ?? null,
        updatedAt: Date.now(),
      };
      await kvStore.setJSON<VipSnapshot>(WIDGET_KV_KEYS.vip, snap);
      Logger.i(TAG, `syncVip isVip=${snap.isVip}`);
    } catch (e) {
      Logger.w(TAG, `syncVip: ${String(e)}`);
    }
  }

  private async syncPlaylists(): Promise<void> {
    try {
      // 用真实 API：playlistApi.list('MUSIC') 返回 PlaylistDto[]（不是 { items }）
      const list: PlaylistDto[] = await playlistApi.list('MUSIC');
      const items: PlaylistRowDto[] = [];
      const limit = Math.min(list.length, PLAYLIST_LIMIT);
      for (let i = 0; i < limit; i++) {
        const it = list[i];
        // 后端 list 不返回顶层 cover/trackCount：
        // 封面取前 4 首曲目（tracks[].cover）的第一首，计数取 _count.tracks
        const ts = it.tracks ?? [];
        const firstCover = ts.length > 0 ? String(ts[0].cover ?? '') : '';
        const rawCover = it.cover ? String(it.cover) : firstCover;
        const cnt = it._count?.tracks ?? 0;
        // 列表封面也走 prefetchCover 转 dataImage（对齐正在播放封面的路径），
        // 网络 URL 在卡片渲染进程不可靠
        items.push({
          id: String(it.id ?? ''),
          name: String(it.name ?? ''),
          cover: await this.resolveCoverToFile(rawCover),
          trackCount: typeof cnt === 'number' ? cnt : 0,
        });
      }
      const store = await this.getPlayerStore();
      const snap: PlaylistsSnapshot = {
        items,
        isPlaying: store ? store.view().isPlaying : false,
        updatedAt: Date.now(),
      };
      await kvStore.setJSON<PlaylistsSnapshot>(WIDGET_KV_KEYS.playlists, snap);
      await this.updateForms(WidgetKind.PLAYLIST, snap);
      Logger.i(TAG, `syncPlaylists count=${items.length}`);
    } catch (e) {
      Logger.w(TAG, `syncPlaylists: ${String(e)}`);
    }
  }

  private async syncHistory(): Promise<void> {
    const store = await this.getPlayerStore();
    try {
      // 用真实 API：userDataApi.trackHistory 返回 LoadMoreResp<TrackHistoryItem>（.list 不是 .items）
      const resp = await userDataApi.trackHistory({ pageSize: 20, loadCount: 1, type: 'MUSIC' });
      const rawItems: TrackHistoryItem[] = resp.list ?? [];
      const items: HistoryRowDto[] = [];
      let n = 0;
      for (let i = 0; i < rawItems.length && n < HISTORY_LIMIT; i++) {
        const it = rawItems[i];
        if (!it.track) continue;
        items.push({
          id: String(it.track.id ?? ''),
          title: String(it.track.name ?? ''),
          artist: String(it.track.artist ?? ''),
          cover: await this.resolveCoverToFile(it.track.cover ? String(it.track.cover) : ''),
        });
        n++;
      }
      const view = store ? store.view() : null;
      const cur = view ? view.queue[view.currentIndex] : undefined;
      const np: NowPlayingSnapshot | null = (view && cur) ? {
        title: cur.title ?? '', artist: cur.artist ?? '', cover: await this.resolveCoverToFile(cur.coverUrl ?? ''),
        colorPrimary: '#3a3a5e', colorSecondary: '#222246',
        isPlaying: view.isPlaying, playMode: view.playMode, isLiked: false,
        updatedAt: Date.now(),
      } : null;
      const snap: HistorySnapshot = { nowPlaying: np, items, updatedAt: Date.now() };
      await kvStore.setJSON<HistorySnapshot>(WIDGET_KV_KEYS.history, snap);
      await this.updateForms(WidgetKind.HISTORY, snap);
      Logger.i(TAG, `syncHistory count=${items.length}`);
    } catch (e) {
      Logger.w(TAG, `syncHistory: ${String(e)}`);
    }
  }

  private async syncLatest(isRefresh: boolean = false): Promise<void> {
    try {
      // 刷新时用 random=true 换一批随机曲目（对齐 iOS 的刷新语义：随机换一批，不是固定列表）
      // 非刷新时用默认（latest 排序），保证卡片初始加载是稳定数据
      const list: TrackDto[] = await trackApi.latest({
        type: 'MUSIC',
        pageSize: LATEST_LIMIT,
        random: isRefresh,
      });
      const items: LatestRowDto[] = [];
      const limit = Math.min(list.length, LATEST_LIMIT);
      for (let i = 0; i < limit; i++) {
        items.push(await this.toLatestRow(list[i]));
      }
      const store = await this.getPlayerStore();
      const snap: LatestSnapshot = {
        items,
        isPlaying: store ? store.view().isPlaying : false,
        updatedAt: Date.now(),
      };
      await kvStore.setJSON<LatestSnapshot>(WIDGET_KV_KEYS.latest, snap);
      await this.updateForms(WidgetKind.LATEST, snap);
      Logger.i(TAG, `syncLatest count=${items.length} refresh=${isRefresh}`);
    } catch (e) {
      Logger.w(TAG, `syncLatest: ${String(e)}`);
    }
  }

  private async toLatestRow(dto: TrackDto): Promise<LatestRowDto> {
    return {
      id: String(dto.id ?? ''),
      title: String(dto.name ?? ''),
      artist: String(dto.artist ?? ''),
      cover: await this.resolveCoverToFile(dto.cover ? String(dto.cover) : ''),
    };
  }

  // ─── formId 注册（EntryFormAbility.onAddForm 调用）────────────────────────

  /**
   * 把 formName → formId 映射写入 kvStore（因为 formProvider.getFormsInfo() 返回的 FormInfo
   * 在 API 24 没有 formId 字段，必须由 EntryFormAbility 主动把 onAddForm 拿到的 formId 登记进来）。
   */
  async registerForm(formName: string, formId: string, formDimension: string): Promise<void> {
    if (formId === '') return;
    const key = `widget_form_ids_${formName}`;
    const bundle = await kvStore.getJSON<FormIdsBundle>(key);
    const ids: string[] = bundle?.ids ?? [];
    if (!ids.includes(formId)) ids.push(formId);
    await kvStore.setJSON<FormIdsBundle>(key, { ids });
    // 写 formId→formName 和 formId→dimension 的反向索引，供 onUpdateForm 反查
    await kvStore.set(`widget_form_name_${formId}`, formName);
    await kvStore.set(`widget_form_dimension_${formId}`, formDimension);
    // 全局索引：兜底 formName 与 WidgetKind 字符串不一致的情况（见 getFormIdsForKind）
    const allBundle = await kvStore.getJSON<FormIdsBundle>(WIDGET_ALL_FORM_IDS);
    const all: string[] = allBundle?.ids ?? [];
    if (!all.includes(formId)) all.push(formId);
    await kvStore.setJSON<FormIdsBundle>(WIDGET_ALL_FORM_IDS, { ids: all });
    Logger.i(TAG, `registerForm name=${formName} id=${formId} dim=${formDimension} all=${all.length}`);
  }

  async unregisterForm(formName: string, formId: string): Promise<void> {
    const key = `widget_form_ids_${formName}`;
    const bundle = await kvStore.getJSON<FormIdsBundle>(key);
    const ids: string[] = (bundle?.ids ?? []).filter((x): boolean => x !== formId);
    await kvStore.setJSON<FormIdsBundle>(key, { ids });
    // 全局索引同步移除
    const allBundle = await kvStore.getJSON<FormIdsBundle>(WIDGET_ALL_FORM_IDS);
    const all: string[] = (allBundle?.ids ?? []).filter((x): boolean => x !== formId);
    await kvStore.setJSON<FormIdsBundle>(WIDGET_ALL_FORM_IDS, { ids: all });
    // 清反向索引
    await kvStore.delete(`widget_form_name_${formId}`);
    await kvStore.delete(`widget_form_dimension_${formId}`);
  }

  /**
   * 取某个 kind 对应的全部 formId。
   *
   * 为什么不能直接读 widget_form_ids_${kind}：这个 key 是卡片进程（EntryFormAbility.onAddForm）
   * 写的，主 App 进程持有的是自己启动时创建的 preferences 缓存实例，读不到卡片进程新写入的值，
   * 会永远返回空数组 → updateForms 直接 return → 卡片永远停在「未在播放」骨架。
   *
   * 所以：先 kvStore.pull() 丢弃缓存从磁盘重载，再读；并且用全局索引 + name 反向索引做交叉兜底，
   * 避免 formName 与 WidgetKind 枚举字符串不一致时完全匹配不上。
   */
  private async getFormIdsForKind(kind: WidgetKind): Promise<string[]> {
    await kvStore.pull();
    const direct = await kvStore.getJSON<FormIdsBundle>(`widget_form_ids_${kind}`);
    const raw: string[] = direct?.ids ?? [];
    // 全局索引交叉兜底：按 formId→formName 反查，命中 kind 的也加进来
    const allBundle = await kvStore.getJSON<FormIdsBundle>(WIDGET_ALL_FORM_IDS);
    const all: string[] = allBundle?.ids ?? [];
    for (let i = 0; i < all.length; i++) {
      const name = await kvStore.get(`widget_form_name_${all[i]}`);
      if (name === String(kind) && !raw.includes(all[i])) {
        raw.push(all[i]);
      }
    }
    // 清洗历史脏数据：旧版 onAddForm 读错了 formId 的 key（用了不存在的
    // ohos.extra.param.key.form_id），把空字符串写进了注册表并持久化。
    // 空 formId 会让 updateForm 报 "The formId is invalid" 且长度算 1，
    // 导致 updateForms 误以为有卡片而提前进入推送流程，真实卡片永远收不到数据。
    const ids: string[] = [];
    let dirty: boolean = false;
    for (let i = 0; i < raw.length; i++) {
      const id: string = raw[i];
      if (id === '' || id === 'undefined' || id === 'null') {
        dirty = true;
        continue;
      }
      if (!ids.includes(id)) ids.push(id);
    }
    if (dirty) {
      Logger.w(TAG, `getFormIdsForKind ${kind}: 清洗脏 formId，重写注册表`);
      await kvStore.setJSON<FormIdsBundle>(`widget_form_ids_${kind}`, { ids });
      await kvStore.setJSON<FormIdsBundle>(WIDGET_ALL_FORM_IDS,
        { ids: all.filter((x): boolean => x !== '' && x !== 'undefined' && x !== 'null') });
    }
    return ids;
  }

  // ─── 写 KV + 推卡片 ──────────────────────────────────────────────────────

  /** 写 KV + 推卡片（同时把当前封面 dataImage 存一份给 EntryFormAbility 恢复用） */

  private async writeAndPushNowPlaying(value: NowPlayingSnapshot): Promise<void> {
    await kvStore.setJSON<NowPlayingSnapshot>(WIDGET_KV_KEYS.nowPlaying, value);
    // 同时存一份封面 dataImage，EntryFormAbility 冷启动恢复播放状态时直接用
    await kvStore.set('widget_now_playing_cover_cache', value.cover);
    await this.updateForms(WidgetKind.PLAYER, value);
  }

  /**
   * The history card contains a copy of the current-player header.  Keep that
   * copy in the same write cycle as the player card so pause/next/like updates
   * cannot leave one card displaying stale playback state.
   */
  private async syncHistoryNowPlaying(nowPlaying: NowPlayingSnapshot): Promise<void> {
    const previous = await kvStore.getJSON<HistorySnapshot>(WIDGET_KV_KEYS.history);
    // 如果当前 nowPlaying 的封面是空或网络 URL（还没 resolve 成 file://），
    // 保留上一次的 file:// 封面避免回退
    const prevCover = previous?.nowPlaying?.cover ?? '';
    const cover = (nowPlaying.cover !== '' && !nowPlaying.cover.startsWith('http'))
      ? nowPlaying.cover
      : prevCover !== '' ? prevCover : nowPlaying.cover;
    const merged: NowPlayingSnapshot = {
      title: nowPlaying.title,
      artist: nowPlaying.artist,
      cover,
      colorPrimary: nowPlaying.colorPrimary,
      colorSecondary: nowPlaying.colorSecondary,
      isPlaying: nowPlaying.isPlaying,
      playMode: nowPlaying.playMode,
      isLiked: nowPlaying.isLiked,
      updatedAt: nowPlaying.updatedAt,
    };
    const snapshot: HistorySnapshot = {
      nowPlaying: merged,
      items: previous?.items ?? [],
      updatedAt: Date.now(),
    };
    await kvStore.setJSON<HistorySnapshot>(WIDGET_KV_KEYS.history, snapshot);
    await this.updateForms(WidgetKind.HISTORY, snapshot);
  }

  /**
   * Playlist and latest cards expose the same global play/pause control as
   * iOS. Update their small state-only snapshots whenever playback changes
   * instead of waiting for the next network refresh.
   */
  private async syncListCardPlaybackState(isPlaying: boolean): Promise<void> {
    const playlists = await kvStore.getJSON<PlaylistsSnapshot>(WIDGET_KV_KEYS.playlists);
    if (playlists) {
      const snapshot: PlaylistsSnapshot = { items: playlists.items, isPlaying, updatedAt: Date.now() };
      await kvStore.setJSON<PlaylistsSnapshot>(WIDGET_KV_KEYS.playlists, snapshot);
      await this.updateForms(WidgetKind.PLAYLIST, snapshot);
    }
    const latest = await kvStore.getJSON<LatestSnapshot>(WIDGET_KV_KEYS.latest);
    if (latest) {
      const snapshot: LatestSnapshot = { items: latest.items, isPlaying, updatedAt: Date.now() };
      await kvStore.setJSON<LatestSnapshot>(WIDGET_KV_KEYS.latest, snapshot);
      await this.updateForms(WidgetKind.LATEST, snapshot);
    }
  }

  /**
   * 推送卡片数据：把整个 snapshot 当 FormBindingData，ArkTS 卡片通过 @LocalStorageProp 接收。
   * 通过 kvStore 里维护的 formName → formId[] 映射拿到目标卡片，逐条 updateForm。
   * 每个 formId 的 dimension 从 widget_form_dimension_${formId} 读，确保不同尺寸卡片渲染正确。
   */
  private async updateForms<T>(kind: WidgetKind, payload: T): Promise<void> {
    try {
      const ids: string[] = await this.getFormIdsForKind(kind);
      Logger.i(TAG, `updateForms kind=${kind} ids=${ids.length}`);
      if (ids.length === 0) return;
      const data: Record<string, Object> = {};
      const keys = Object.keys(payload as object);
      for (let i = 0; i < keys.length; i++) {
        data[keys[i]] = (payload as Record<string, Object>)[keys[i]];
      }
      // isLocked 卡片侧按 VIP 判定，主 App 推送时带上当前缓存值避免卡片闪回锁定页
      const vip = await kvStore.getJSON<VipSnapshot>(WIDGET_KV_KEYS.vip);
      data['isLocked'] = vip ? !vip.isVip : false;
      for (let i = 0; i < ids.length; i++) {
        const formId: string = ids[i];
        try {
          // 每个 formId 单独拼 dimension（不同尺寸卡片渲染不同布局）
          const dim = await kvStore.get(`widget_form_dimension_${formId}`) ?? '2*2';
          data['formDimension'] = dim;
          const binding = formBindingData.createFormBindingData(data);
          await formProvider.updateForm(formId, binding);
          Logger.i(TAG, `updateForm ${formId} kind=${kind} dim=${dim}`);
        } catch (e) {
          // "The ID of the form to be operated does not exist" → 卡片已被用户从桌面删除，
          // 从注册表移除孤儿 formId 避免后续推送继续报错。
          const msg = String(e);
          if (msg.includes('does not exist') || msg.includes('not exist') || msg.includes('invalid')) {
            const name = await kvStore.get(`widget_form_name_${formId}`) ?? String(kind);
            Logger.w(TAG, `updateForm ${formId} 已不存在，自动 unregister（name=${name}）`);
            await this.unregisterForm(name, formId).catch((): void => undefined);
          } else {
            Logger.w(TAG, `updateForm ${formId}: ${msg}`);
          }
        }
      }
    } catch (e) {
      Logger.w(TAG, `updateForms ${kind}: ${String(e)}`);
    }
  }

  // ─── 给 WidgetCommandHandler 用的辅助方法 ────────────────────────────────

  /** 立即 cycle 播放模式（iOS mode 按钮行为，调用现有 togglePlayMode） */
  cyclePlayMode(): void {
    this.getPlayerStore().then((store: PlayerStoreLite | null): void => {
      if (store) store.togglePlayMode();
    });
  }

  /** 立即刷新（refresh_latest 指令后调用）：拉更多条，跳过当前已展示的，换一批 */
  async refreshLatestNow(): Promise<void> {
    // 如果 KV 里从来没有数据（冷启动 refreshAll 还没跑完 / 设备一直没重启），
    // 先拉一次基础数据再换批，否则刷新没东西可换
    const existing = await kvStore.getJSON<LatestSnapshot>(WIDGET_KV_KEYS.latest);
    if (!existing || existing.items.length === 0) {
      await this.syncLatest(false);
      return;
    }
    await this.syncLatest(true);
  }

  /** 立即刷新歌单（play_playlist 路径上如果需要也可用） */
  async refreshPlaylistsNow(): Promise<void> {
    await this.syncPlaylists();
  }

  /** 读 VIP 状态（卡片锁定页判定） */
  async readVip(): Promise<VipSnapshot> {
    const v = await kvStore.getJSON<VipSnapshot>(WIDGET_KV_KEYS.vip);
    return v ?? { isVip: false, expiresAt: null, updatedAt: 0 };
  }
}

export const widgetBridge = new WidgetBridgeImpl();

/** 重新导出供卡片组件引用 */
export { getImageUrl };
