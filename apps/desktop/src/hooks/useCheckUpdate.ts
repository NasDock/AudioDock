import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import pkg from '../../package.json';
import {
  getLatestVersion,
  pickDesktopDownloadFile,
  resolveDesktopPlatformKey,
} from '../services/update';
import { tauriOpenExternal } from '../utils/platform';

/** GitHub 仓库：只用来取 Release 正文作为更新说明（版本号/安装包走自有后端） */
const GITHUB_USER = 'mmdctjj';
const GITHUB_REPO = 'AudioDock';

export interface UpdateInfo {
  version: string;
  body: string;
  downloadUrl: string;
  /** 安装包文件名（如 AudioDock_1.2.9_aarch64.dmg），弹窗里展示给用户看 */
  fileName?: string;
  /** 安装包大小（字节） */
  fileSize?: number;
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
 * - 命中当前端 scope（如 `feat(desktop): xxx`）→ app
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

export const useCheckUpdate = () => {
  const { t } = useTranslation();
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [loading, setLoading] = useState(false);

  /** 拉 GitHub Release 正文作为更新说明，失败时用兜底文案 */
  const fetchReleaseBody = async (version: string): Promise<string> => {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/releases/tags/v${version}`,
      );
      const data = await res.json();
      if (data?.body) return data.body as string;
    } catch (e) {
      console.warn('[update] 拉取 GitHub Release 说明失败:', e);
    }
    return t('update.defaultReleaseNotes');
  };

  const checkUpdate = async () => {
    setLoading(true);
    try {
      // 1. 版本号 + 安装包列表统一由后端下发（与 mobile 端一致）
      const { version: remoteVersion, files } = await getLatestVersion();
      if (!remoteVersion) return;
      if (compareVersions(remoteVersion, pkg.version) <= 0) return;

      // 2. 更新说明
      const body = await fetchReleaseBody(remoteVersion);

      // 3. 按平台过滤 changelog：仅服务端更新时只弹提醒；与当前端无关时不弹窗
      const target = classifyRelease(body || '', 'desktop');
      if (target === 'none') {
        console.log(`Version ${remoteVersion} has no desktop-related changes, skip popup`);
        return;
      }
      if (target === 'server') {
        setUpdateInfo({
          version: remoteVersion,
          body,
          downloadUrl: '',
          serverOnly: true,
        });
        return;
      }

      // 4. 按当前系统 + 架构挑安装包（macOS/Windows/Linux 各自一份）
      const platformKey = await resolveDesktopPlatformKey();
      const file = pickDesktopDownloadFile(files, platformKey);
      if (!file) {
        console.warn(`[update] 后端未下发 ${platformKey} 的安装包，跳过弹窗`);
        return;
      }

      setUpdateInfo({
        version: remoteVersion,
        body,
        downloadUrl: file.url,
        fileName: file.filename,
        fileSize: file.size,
      });
    } catch (e) {
      console.error('Check update failed', e);
    } finally {
      setLoading(false);
    }
  };

  /**
   * 点击「去下载」：交给系统浏览器打开安装包直链
   *
   * 后端下发的是 MinIO 预签名地址，有效期只有几分钟，
   * 所以点按钮时重新拉一次链接（拿不到才退回弹窗里那份），避免用户停留久了点开是 403。
   */
  const startDownload = async () => {
    const info = updateInfo;
    if (!info || info.serverOnly) return;
    let url = info.downloadUrl;
    try {
      const platformKey = await resolveDesktopPlatformKey();
      const { version, files } = await getLatestVersion();
      if (version === info.version) {
        const fresh = pickDesktopDownloadFile(files, platformKey);
        if (fresh?.url) url = fresh.url;
      }
    } catch (e) {
      console.warn('[update] 刷新下载链接失败，使用弹窗中的链接:', e);
    }
    if (!url) {
      console.warn('[update] 没有可用的下载链接');
      return;
    }
    await tauriOpenExternal(url);
  };

  const cancelUpdate = () => {
    setUpdateInfo(null);
  };

  return { checkUpdate, updateInfo, cancelUpdate, startDownload, loading };
};

/**
 * semver 比对，支持预发布版本（如 1.2.3-beta.1）。
 * 返回 1: v1 > v2，0: 相等，-1: v1 < v2
 * 规则：主版本号逐段比较；相同时有 prerelease 的一方更小
 * （1.2.3-beta.1 < 1.2.3），两边都有 prerelease 则逐段比较标识符，
 * 数字段按数值比，非数字段按字典序，数字段小于非数字段。
 */
function compareVersions(v1: string, v2: string) {
  const [core1, pre1] = splitVersion(v1);
  const [core2, pre2] = splitVersion(v2);

  for (let i = 0; i < 3; i++) {
    const n1 = core1[i] || 0;
    const n2 = core2[i] || 0;
    if (n1 > n2) return 1;
    if (n1 < n2) return -1;
  }

  // core 相同：无 prerelease 的一方更大
  if (!pre1.length && !pre2.length) return 0;
  if (!pre1.length) return 1;
  if (!pre2.length) return -1;

  for (let i = 0; i < Math.max(pre1.length, pre2.length); i++) {
    const a = pre1[i];
    const b = pre2[i];
    // 段数少的一方更小（beta.1 < beta.1.1）
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    const numA = /^\d+$/.test(a) ? Number(a) : null;
    const numB = /^\d+$/.test(b) ? Number(b) : null;
    if (numA !== null && numB !== null) {
      if (numA !== numB) return numA > numB ? 1 : -1;
    } else if (numA !== null) {
      return -1; // 数字段 < 非数字段
    } else if (numB !== null) {
      return 1;
    } else if (a !== b) {
      return a > b ? 1 : -1;
    }
  }
  return 0;
}

function splitVersion(v: string): [number[], string[]] {
  // 丢弃 build metadata（+ 之后的部分），不参与优先级比较
  const withoutBuild = v.split('+')[0];
  const dash = withoutBuild.indexOf('-');
  const core = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash);
  const pre = dash === -1 ? '' : withoutBuild.slice(dash + 1);
  return [
    core.split('.').map((n) => Number(n) || 0),
    pre ? pre.split('.') : [],
  ];
}
