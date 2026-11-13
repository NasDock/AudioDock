import { plusRequest } from '@soundx/services';
import type { ISuccessResponse } from '@soundx/services';
import { isTauri } from '../utils/platform';

/**
 * 版本检查与下载地址（与 mobile 端 `src/services/update.ts` 保持同构）
 *
 * 版本号与安装包地址统一由自有后端 `/download/latest` 下发，
 * 不再依赖 GitHub Release assets（国内访问不稳定，且无认证 API 有速率限制）。
 */

/** 后端 /download/latest 接口返回的文件条目 */
export interface DownloadFileInfo {
  /** 平台标识，如 macos-arm64 / windows-x64 / linux-appimage / android */
  platform: string;
  /** 展示用名称，如 "macOS (Apple Silicon)" */
  label: string;
  filename: string;
  /** 字节数 */
  size: number;
  /** 直链（MinIO 预签名，有效期很短，用前最好重新拉一次） */
  url: string;
}

export interface DownloadLatestData {
  version: string;
  files?: DownloadFileInfo[];
}

/** 业务层返回的精简结构 */
export interface LatestVersionResult {
  /** 远端版本号（如 "1.3.0"），null 表示接口异常 */
  version: string | null;
  /** 远端下发的安装包列表，null 表示接口未下发 / 异常 */
  files: DownloadFileInfo[] | null;
}

/** 桌面端安装包的平台标识（与后端 files[].platform 对应） */
export type DesktopPlatformKey =
  | 'macos-arm64'
  | 'macos-x64'
  | 'windows-x64'
  | 'windows-arm64'
  | 'linux-appimage'
  | 'linux-deb';

/**
 * 调用后端拉取最新版本号与安装包列表
 *
 * @param product 服务端约定的产品标识（当前 AudioDock 传 "audiodock"）
 * @returns 接口异常时返回 `{ version: null, files: null }`，调用方静默失败即可
 */
export const getLatestVersion = async (
  product: string = 'audiodock',
): Promise<LatestVersionResult> => {
  try {
    const response = await plusRequest.get<ISuccessResponse<DownloadLatestData>>(
      '/download/latest',
      { params: { product } },
    );
    const body = response.data;
    if (body?.code !== 200 || !body?.data?.version) {
      console.log('[update] /download/latest 返回异常:', body);
      return { version: null, files: null };
    }
    return { version: body.data.version, files: body.data.files ?? null };
  } catch (e) {
    // 网络异常 / 5xx：静默失败，不打扰用户
    console.warn('[update] /download/latest 请求失败:', e);
    return { version: null, files: null };
  }
};

/** 浏览器端能拿到的架构信息（UA-CH 只有 Chromium 系支持） */
type BrowserArch = 'arm64' | 'x64';

const guessBrowserArch = async (): Promise<BrowserArch | null> => {
  if (typeof navigator === 'undefined') return null;
  try {
    const uaData = (
      navigator as Navigator & {
        userAgentData?: {
          getHighEntropyValues?: (
            hints: string[],
          ) => Promise<{ architecture?: string; bitness?: string }>;
        };
      }
    ).userAgentData;
    const values = await uaData?.getHighEntropyValues?.(['architecture', 'bitness']);
    if (values?.architecture === 'arm') return 'arm64';
    if (values?.architecture === 'x86') return 'x64';
  } catch {
    // 忽略：非 Chromium 浏览器没有 UA-CH
  }
  const ua = navigator.userAgent;
  if (/aarch64|arm64/i.test(ua)) return 'arm64';
  if (/win64|x86_64|amd64/i.test(ua)) return 'x64';
  return null;
};

/**
 * 解析当前设备应下载哪个平台的安装包
 *
 * - Tauri：系统与架构都由原生层给出，结果精确
 * - 浏览器：UA 判系统；架构拿不到时按主流默认
 *   （Windows 默认 x64，macOS 默认 arm64 —— Apple Silicon 已占绝大多数）
 */
export const resolveDesktopPlatformKey = async (): Promise<DesktopPlatformKey> => {
  if (isTauri()) {
    try {
      const { platform, arch } = await import('@tauri-apps/plugin-os');
      const os = platform();
      const isArm = /aarch64|arm/i.test(arch());
      if (os === 'macos') return isArm ? 'macos-arm64' : 'macos-x64';
      if (os === 'windows') return isArm ? 'windows-arm64' : 'windows-x64';
      // Linux 统一给 AppImage（免安装、通用）
      return 'linux-appimage';
    } catch (e) {
      console.warn('[update] 读取系统架构失败，回退到 UA 判断:', e);
    }
  }

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const arch = await guessBrowserArch();
  if (/windows/i.test(ua)) return arch === 'arm64' ? 'windows-arm64' : 'windows-x64';
  if (/mac os x|macintosh/i.test(ua)) return arch === 'x64' ? 'macos-x64' : 'macos-arm64';
  return 'linux-appimage';
};

/**
 * 从后端文件列表中挑出当前平台的安装包
 *
 * 优先精确匹配；其次同系统的另一架构（Apple Silicon ↔ Intel、x64 ↔ arm64）；
 * 最后兜底 Linux 通用包。
 */
export const pickDesktopDownloadFile = (
  files: DownloadFileInfo[] | null,
  platformKey: DesktopPlatformKey,
): DownloadFileInfo | null => {
  if (!files?.length) return null;
  const exact = files.find((f) => f.platform === platformKey);
  if (exact) return exact;
  const osPrefix = `${platformKey.split('-')[0]}-`;
  const sameOs = files.find((f) => f.platform.startsWith(osPrefix));
  if (sameOs) return sameOs;
  return files.find((f) => f.platform === 'linux-appimage') ?? null;
};
