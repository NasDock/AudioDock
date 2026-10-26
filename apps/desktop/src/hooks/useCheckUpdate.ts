import { useState } from 'react';
import pkg from '../../package.json';
import { isWeb } from '../utils/platform';

const GITHUB_USER = 'mmdctjj';
const GITHUB_REPO = 'AudioDock';

export interface UpdateInfo {
  version: string;
  body: string;
  downloadUrl: string;
  assets: any[];
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
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const checkUpdate = async (manual = false) => {
    setLoading(true);
    try {
      const res = await fetch(`https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/releases/latest`);
      const data = await res.json();
      const remoteVersion = data.tag_name?.replace(/^v/, '');
      const localVersion = pkg.version;

      if (remoteVersion && compareVersions(remoteVersion, localVersion) > 0) {
        // 按平台过滤 changelog：仅服务端更新时只弹提醒；与当前端无关时不弹窗
        const target = classifyRelease(data.body || '', 'desktop');
        if (target === 'none') {
          console.log(`Version ${remoteVersion} has no desktop-related changes, skip popup`);
          return;
        }
        if (target === 'server') {
          setUpdateInfo({
            version: remoteVersion,
            body: data.body || '',
            downloadUrl: "",
            assets: [],
            serverOnly: true,
          });
          return;
        }

        if (isWeb()) {
          setUpdateInfo({
            version: remoteVersion,
            body: data.body,
            downloadUrl: "",
            assets: data.assets || []
          });
          return;
        }

        // Find asset based on platform
        const platform = getPlatform();
        let asset = null;
        if (data.assets && Array.isArray(data.assets)) {
          if (platform === 'win') {
             // Prefer setup exe, exclude blockmap
             asset = data.assets.find((a: any) => a.name.endsWith('.exe') && !a.name.includes('blockmap'));
          } else if (platform === 'mac') {
             // Prefer dmg
             asset = data.assets.find((a: any) => a.name.endsWith('.dmg'));
             if (!asset) asset = data.assets.find((a: any) => a.name.endsWith('.zip') && !a.name.includes('source'));
          } else if (platform === 'linux') {
             asset = data.assets.find((a: any) => a.name.endsWith('.AppImage'));
             if (!asset) asset = data.assets.find((a: any) => a.name.endsWith('.deb'));
          }
        }

        if (!asset) {
          console.log(`No matching asset found for platform ${platform} in version ${remoteVersion}`);
          return;
        }

        const downloadUrl = asset.browser_download_url;

        setUpdateInfo({
          version: remoteVersion,
          body: data.body,
          downloadUrl: downloadUrl,
          assets: data.assets
        });
      } else {
         if(manual) {
             // We can return a status or let the caller handle 'no update' logic if needed,
             // currently just doing nothing for manual check 'no update' case in hook state.
             // Ideally we should have a callback or return value.
         }
      }
    } catch (e) {
      console.error("Check update failed", e);
    } finally {
      setLoading(false);
    }
  };

  const cancelUpdate = () => {
    setUpdateInfo(null);
  };

  return { checkUpdate, updateInfo, cancelUpdate, loading };
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

function getPlatform() {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('win')) return 'win';
  if (ua.includes('mac')) return 'mac';
  if (ua.includes('linux')) return 'linux';
  return 'unknown';
}
