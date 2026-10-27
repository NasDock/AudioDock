import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import { getLatestVersion } from '../src/services/update';
import type { DownloadFileInfo } from '../src/services/update';
import {
  compareVersions,
  downloadAndInstallApk,
  getLocalVersion,
} from '../src/utils/updateUtils';
import { isNative } from '../src/utils/platform';

/** 配置常量：GitHub 仓库（用于拉取 release changelog） */
const GITHUB_USER = 'mmdctjj';
const GITHUB_REPO = 'AudioDock';
/** AsyncStorage key：用户主动忽略的版本号（同一版本不再弹窗） */
const IGNORED_VERSION_KEY = 'ignored_version';

/**
 * 版本更新信息（弹窗 / 手动检查返回值）
 *
 * v3：mobile 端不再按设备品牌分流，全部走「国内仓库 APK 直装」
 * （即原来仅小米/红米走的那条路径）。后端 files 中只要下发
 * platform='android' 的 APK URL，无论用户设备品牌是什么品牌都直装。
 * iOS 暂不走更新流程（iOS 上架滞后，本地 build 无可用版本），
 * checkUpdate 在 iOS 上拿到 APK URL 后仍交给 SystemDownloadManager，
 * 由 updateUtils 内部做平台判断（iOS 上 noop，弹窗关闭）。
 */
export interface UpdateInfo {
  /** 远端版本号（如 "1.3.0"） */
  version: string;
  /** 更新说明（GitHub Release body markdown） */
  body: string;
  /** APK 直装 URL（来自后端 /download/latest files[platform=android]） */
  downloadUrl: string;
  /** true = 本次发布仅服务端（api）更新，客户端无需升级，只弹提醒 */
  serverOnly?: boolean;
}

/** 更新目标分类：app=当前端有更新；server=仅服务端更新；none=与当前端无关 */
export type ReleaseTarget = 'app' | 'server' | 'none';

/** 各端在 conventional commit scope 中的别名 */
const PLATFORM_SCOPES: Record<string, string[]> = {
  desktop: ['desktop', 'electron'],
  mobile: ['mobile', 'android', 'ios'],
  hm: ['hm', 'harmony', 'harmonyos', 'ohos'],
};
/** 服务端 scope：命中且当前端无更新时只弹「服务端更新提醒」 */
const SERVER_SCOPES = ['api', 'server', 'backend', 'service', 'services'];

/**
 * 按 conventional commit scope 过滤 Release body，判断该版本与当前端的关系：
 * - 无 scope（如 `feat: xxx`）视为全端更新 → app
 * - 命中当前端 scope（如 `feat(mobile): xxx`）→ app
 * - 仅命中服务端 scope（如 `feat(api): xxx`）→ server
 * - 仅命中其他端 scope → none（当前端不弹窗）
 * - body 完全不符合该格式（无法识别）→ 兜底按 app 处理，保持旧行为
 */
export function classifyRelease(body: string, platform: 'desktop' | 'mobile' | 'hm'): ReleaseTarget {
  const lineRe = /^\s*[-*]?\s*(feat|fix|perf|refactor|revert|chore|docs|style|test|build|ci)(?:\(([^)]*)\))?\s*[:：]/i;
  let matched = false;
  let hasUnscoped = false;
  let hasPlatform = false;
  let hasServer = false;
  const aliases = PLATFORM_SCOPES[platform] || [];
  for (const line of body.split('\n')) {
    const m = line.match(lineRe);
    if (!m) continue;
    matched = true;
    const scope = m[2] ? m[2].trim().toLowerCase() : '';
    if (!scope) {
      hasUnscoped = true;
    } else if (aliases.includes(scope)) {
      hasPlatform = true;
    } else if (SERVER_SCOPES.includes(scope)) {
      hasServer = true;
    }
  }
  if (!matched) return 'app';
  if (hasUnscoped || hasPlatform) return 'app';
  if (hasServer) return 'server';
  return 'none';
}

/** Hook 内部状态 */
interface UseCheckUpdateState {
  /** 是否正在检查中（用于按钮 loading 态） */
  checking: boolean;
  /** 是否正在创建下载任务 */
  opening: boolean;
  /** APK 下载进度（0~1；当前实现下弹窗提交任务后即关闭，进度回调实际不展示） */
  progress: number;
  /** 发现的更新信息（null = 当前已是最新 / 已忽略 / 接口异常 / 后端未下发 APK URL） */
  updateInfo: UpdateInfo | null;
}

/**
 * 版本检查 Hook
 *
 * 更新方式：统一走「国内仓库 APK 直装」（系统下载器）；
 * 不再区分小米/其他 Android 品牌，也不再跳应用商店。
 *
 * 用法：
 *   const { checking, updateInfo, checkUpdate, startUpdate, ignoreUpdate } =
 *     useCheckUpdate();
 *
 *   // 启动时静默检查
 *   useEffect(() => { void checkUpdate(); }, []);
 *
 *   // 手动触发（设置页按钮）
 *   const onPress = async () => {
 *     const info = await checkUpdate();
 *     if (!info) Alert.alert(t('update.upToDate')); // "已是最新版本"
 *   };
 *
 *   // 弹窗按钮
 *   <UpdateModal
 *     visible={!!updateInfo}
 *     updateInfo={updateInfo}
 *     onUpdate={startUpdate}
 *     onIgnore={ignoreUpdate}
 *     onCancel={cancelUpdate}
 *   />
 */
export const useCheckUpdate = () => {
  const { t } = useTranslation();
  const [state, setState] = useState<UseCheckUpdateState>({
    checking: false,
    opening: false,
    progress: 0,
    updateInfo: null,
  });

  /**
   * 拉取 GitHub Release body 作为更新说明
   * 失败时 fallback 到一段默认文案
   */
  const fetchReleaseBody = async (version: string): Promise<string> => {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/releases/tags/v${version}`,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await res.json();
      if (data?.body) return data.body;
    } catch (e) {
      console.warn('[useCheckUpdate] fetch github release body failed:', e);
    }
    return t('update.defaultReleaseNotes');
  };

  /**
   * 从后端下发的 files 中取 Android APK 直装地址
   *
   * 统一走 APK 直装后不再区分品牌，只要后端 files 里有 platform=android
   * 的条目就拿它的 url。iOS 上虽然也会拿到这个 URL，下面的 startUpdate
   * 仍会调 downloadAndInstallApk，由 updateUtils 内部做平台判断（iOS 上 noop）。
   */
  const pickAndroidApkUrl = (files: DownloadFileInfo[] | null): string | null => {
    const apk = files?.find((f) => f.platform === 'android');
    return apk?.url || null;
  };

  /**
   * 执行一次版本检查
   *
   * @returns 发现的 UpdateInfo，若无需更新/已忽略/接口异常/后端未下发 APK URL 则返回 null
   */
  const checkUpdate = useCallback(async (): Promise<UpdateInfo | null> => {
    // Web 端不支持 APK 直装，直接跳过
    if (!isNative()) return null;

    setState((s) => ({ ...s, checking: true }));
    try {
      // 1. 调后端拿远端版本 + 文件列表
      const { version: remoteVersion, files } = await getLatestVersion();
      if (!remoteVersion) return null;

      // 2. 检查是否被用户忽略
      const ignored = await AsyncStorage.getItem(IGNORED_VERSION_KEY);
      if (remoteVersion === ignored) {
        console.log(`[useCheckUpdate] version ${remoteVersion} is ignored`);
        return null;
      }

      // 3. 比较版本号
      const localVersion = getLocalVersion();
      console.log(`[useCheckUpdate] local=${localVersion} remote=${remoteVersion}`);
      if (compareVersions(remoteVersion, localVersion) !== 1) {
        return null;
      }

      // 4. 拉 changelog
      const body = await fetchReleaseBody(remoteVersion);

      // 4.5 按平台过滤 changelog：仅服务端更新时只弹提醒；与当前端无关时不弹窗
      const target = classifyRelease(body, 'mobile');
      if (target === 'none') {
        console.log(`[useCheckUpdate] version ${remoteVersion} has no mobile-related changes, skip popup`);
        return null;
      }
      if (target === 'server') {
        const serverInfo: UpdateInfo = { version: remoteVersion, body, downloadUrl: '', serverOnly: true };
        setState((s) => ({ ...s, updateInfo: serverInfo }));
        return serverInfo;
      }

      // 5. 统一从后端取 platform=android 的 APK URL（不再按设备品牌分流）
      const downloadUrl = pickAndroidApkUrl(files);
      if (!downloadUrl) {
        console.warn('[useCheckUpdate] 后端未下发 Android APK 下载地址');
        return null;
      }

      const info: UpdateInfo = { version: remoteVersion, body, downloadUrl };
      setState((s) => ({ ...s, updateInfo: info }));
      return info;
    } catch (e) {
      console.warn('[useCheckUpdate] checkUpdate error:', e);
      return null;
    } finally {
      setState((s) => ({ ...s, checking: false }));
    }
  }, []);

  /**
   * 执行更新（用户点击「立即更新」时调用）
   *
   * 统一走系统下载器下载 APK（SystemDownloadManager）；
   * iOS 上由 updateUtils 内部 noop，弹窗关闭即视为「暂无 iOS 版本」。
   *
   * 行为要点：进入函数立即关闭弹窗（updateInfo=null）；
   * 只有创建下载任务失败时，才把弹窗恢复回来，让用户重试或忽略。
   */
  const startUpdate = useCallback(async () => {
    const info = state.updateInfo;
    // 立即关闭弹窗（保留 opening=true，保持 state 一致性便于失败时恢复；
    // 弹窗已关，按钮不会渲染）
    setState((s) => ({ ...s, opening: true, updateInfo: null, progress: 0 }));
    try {
      if (info?.serverOnly) {
        // 服务端提醒视图没有「立即更新」入口，防御性 noop
        console.warn('[useCheckUpdate] startUpdate called on serverOnly notice');
      } else if (info?.downloadUrl) {
        await downloadAndInstallApk(info.downloadUrl, (p) => {
          // 弹窗已关，进度回调不影响 UI；保留调用以满足 updateUtils 接口
          setState((s) => ({ ...s, progress: p }));
        });
      } else {
        // 防御：理论上 checkUpdate 已经保证了 downloadUrl 非空才返回 updateInfo
        console.warn('[useCheckUpdate] startUpdate but no downloadUrl');
      }
    } catch (e) {
      console.warn('[useCheckUpdate] startUpdate error:', e);
      // 创建下载任务失败 → 恢复弹窗让用户重试或忽略
      setState((s) => ({ ...s, updateInfo: info }));
      Alert.alert(t('update.downloadApkFailedTitle'), t('update.downloadApkFailedBody'));
    } finally {
      setState((s) => ({ ...s, opening: false }));
    }
  }, [state.updateInfo, t]);

  /**
   * 忽略当前版本（写入 AsyncStorage）
   */
  const ignoreUpdate = useCallback(async () => {
    if (state.updateInfo) {
      await AsyncStorage.setItem(IGNORED_VERSION_KEY, state.updateInfo.version);
    }
    setState((s) => ({ ...s, updateInfo: null, progress: 0 }));
  }, [state.updateInfo]);

  /**
   * 关闭弹窗（不忽略，下次启动仍会再询问）
   */
  const cancelUpdate = useCallback(() => {
    setState((s) => ({ ...s, updateInfo: null, progress: 0 }));
  }, []);

  return {
    checking: state.checking,
    opening: state.opening,
    progress: state.progress,
    updateInfo: state.updateInfo,
    checkUpdate,
    startUpdate,
    ignoreUpdate,
    cancelUpdate,
  };
};
