import { getBaseURL } from "../https";
import { bucketWidth, isThumbnailBucket } from "./imageBucket";
import { getMediaHeaders } from "./mediaAuth";
import { isInternalNetworkSync } from "./networkMode";

/**
 * Get full image URL
 *
 * 分级加载（详见 `./imageBucket.ts`）：
 *  1. width 先量化到固定档位 [96,128,300,600,900,1200]，避免后端缓存碎片化；
 *  2. 缩略图档位（≤300）恒走 /image/optimize，不区分内外网 —— 列表一屏 N 张图，
 *     瓶颈是解码内存而非网速（50 张 3000×3000 原图 = 1.8GB 位图，必然 OOM）；
 *  3. 大图档位（>300）才看网络环境：内网直连原图，外网走 optimize。
 *
 * 注意：本函数必须保持同步纯函数 —— 它被 40+ 处调用点在 React 渲染里同步调用，
 * 改成 async 会波及全部调用点。网络状态通过 `networkMode.ts` 的模块级变量同步读取。
 *
 * @param path Image path or URL
 * @param placeholder Alternative placeholder if path is missing
 * @param width 目标设备像素宽度（按显示尺寸 ×2 估算），默认 300。
 *   默认 300 落在「恒压缩」档 —— 未显式标注尺寸的调用点一律拿到缩略图，安全默认值。
 * @returns Full URL
 */
export const getImageUrl = (
  path?: string | null,
  placeholder?: string,
  width = 300,
) => {
  if (!path) return placeholder || "https://picsum.photos/seed/placeholder/200/200";
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  const baseURL = getBaseURL();
  const cleanBaseURL = baseURL.endsWith("/") ? baseURL.substring(0, baseURL.length - 1) : baseURL;
  const cleanPath = path.startsWith("/") ? path.substring(1) : path;
  const originalUrl = `${cleanBaseURL}/${cleanPath.split('/').map(encodeURIComponent).join('/')}`;

  // 只有 /covers/ 能走缩略图代理。
  // /music/ 虽然在后端白名单里，但 `resolveLocalSource` 对它返回 null
  // （image-optimize.service.ts:142-149），请求必 404。
  if (!cleanPath.startsWith("covers/") || width < 16) {
    return originalUrl;
  }

  const bucket = bucketWidth(width);

  // 大图档位才按网络环境区分；缩略图档位恒压缩（理由见 imageBucket.ts）。
  if (!isThumbnailBucket(bucket) && isInternalNetworkSync()) {
    return originalUrl;
  }

  const src = `/${cleanPath}`;
  return `${cleanBaseURL}/image/optimize?src=${encodeURIComponent(src)}&w=${bucket}&q=72&fmt=webp`;
};

/**
 * 播放页「磨砂底图」URL：服务端 sharp 预模糊的小图。
 *
 * 为什么不用 expo-image 的 blurRadius：
 *  - Android 侧是 Glide `BlurTransformation(min(radius,25), 4)`，`sampling=4` 写死 ——
 *    先把图缩小 4 倍再按 radius 模糊，等效半径 = radius × 4。96px 小图缩到 24px 后
 *    用半径 25 模糊（超过图幅 100%）会直接糊成**均匀色块**，看起来像"没有模糊"；
 *  - RenderScript 在 Android 12+ 已废弃，部分机型直接抛异常回退 CPU 栈模糊；
 *  - iOS 侧 radius 还要 /2，两端观感天然对不齐。
 * 服务端出图没有这些分支：四端拿到的是同一张已模糊的 webp，客户端零 GPU 开销。
 *
 * 不走档位量化（bucketWidth）：模糊图是独立缓存维度，尺寸固定不产生碎片；
 * 且必须强制走 optimize（大图档位内网会直连原图，拿不到模糊）。
 *
 * @param cover track.cover（/covers/xxx）
 * @param width 取图宽度，默认 192（放大到全屏仍有封面轮廓，不会糊成纯色）
 * @param sigma 高斯模糊 sigma，默认 12
 */
export const getBlurredCoverUrl = (
  cover?: string | null,
  width = 192,
  sigma = 12,
): string | undefined => {
  if (!cover) return undefined;
  // 外链封面（Emby/Subsonic）服务端白名单不支持，交给调用方回退
  if (cover.startsWith("http://") || cover.startsWith("https://")) return undefined;
  const cleanPath = cover.startsWith("/") ? cover.substring(1) : cover;
  if (!cleanPath.startsWith("covers/")) return undefined;

  const baseURL = getBaseURL();
  const cleanBaseURL = baseURL.endsWith("/")
    ? baseURL.substring(0, baseURL.length - 1)
    : baseURL;
  const src = `/${cleanPath}`;
  return `${cleanBaseURL}/image/optimize?src=${encodeURIComponent(src)}&w=${width}&q=72&fmt=webp&blur=${sigma}`;
};

/**
 * 图片 source（含鉴权头）。
 *
 * 与 `getImageUrl` 的区别：飞牛音乐的封面接口只认 `Authorization` 头，
 * `<Image>` / `expo-image` 都是从 source 上读 headers 的，
 * 所以飞牛源必须用这个函数返回的对象，不能只用裸 URL。
 *
 * @param path 图片路径或完整 URL
 * @param placeholder 缺图时的占位图
 * @param width 目标设备像素宽度，默认 300
 */
export const getImageSource = (
  path?: string | null,
  placeholder?: string,
  width = 300,
): { uri: string; headers?: Record<string, string> } => {
  const uri = getImageUrl(path, placeholder, width);
  const headers = getMediaHeaders();
  return Object.keys(headers).length > 0 ? { uri, headers } : { uri };
};
