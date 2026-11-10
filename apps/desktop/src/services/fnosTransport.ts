import {
  setFnosAuthKeys,
  setFnosMediaProxy,
  setFnosTransport,
  type FnosTransport,
} from "@soundx/services";
import { invoke } from "@tauri-apps/api/core";
import { cacheUtils } from "../utils/cache";
import { isWeb } from "../utils/platform";

/**
 * 飞牛音乐（fnOS trim.music）的 HTTP 传输层。
 *
 * 飞牛网关**不返回任何 CORS 响应头**，未登录时还会 302 到 SPA 登录页，
 * 所以浏览器里不能直接 XHR。两条链路各自解决：
 *
 * - **桌面端（Tauri）**：走 `fnos_request` 命令在 Rust 侧发请求，
 *   请求头（含 `Cookie: mode=relay`）原样透传，302 不被静默跟随
 *   （见 `src-tauri/src/fnos_http.rs`）。
 * - **web（vite dev）**：走 `/__fnos` 由 dev server 代转并补 Cookie
 *   （见 `vite-plugin-fnos-proxy.ts`），浏览器侧是同源请求，绕开 CORS。
 *
 * 生产 web 构建没有这个中间件，会退回默认 axios —— 那种部署需要真正的反向代理。
 */

interface FnosRustResponse {
  status: number;
  body: string;
  contentType?: string;
  location?: string | null;
}

const REDIRECT_HINT = (status: number, location?: string | null) =>
  `飞牛音乐返回重定向（HTTP ${status}）${
    location ? ` → ${location}` : ""
  }，通常是中继未放行（Cookie: mode=relay 丢失）或会话已失效`;

/**
 * 桌面端媒体代理就绪信号。
 *
 * 封面/音频地址由 `buildMediaUrl()` 拼，必须指向本地 127.0.0.1 转发服务
 * （`src-tauri/src/fnos_media.rs`）。端口要异步问 Rust 才知道，而首个媒体地址
 * 一定出现在某个业务请求返回之后 —— 所以在 `tauriTransport` 里 await 它，
 * 就保证了「生成媒体地址时前缀已就绪」。
 */
let mediaProxyReady: Promise<void> | null = null;

/** 最近一次同步给 Rust 的会话标识（origin + cookie），用于去重 */
let syncedSession = "";

/**
 * 把当前请求的 Cookie 同步给 Rust 的 `/fnos/*` 转发服务。
 *
 * 会话 Token 只在 Cookie 里（`music-token=…`，中继还有 `mode=relay`），
 * 而 `<img>` / `<audio>` 带不了请求头，只能让本地转发服务替我们带上。
 * 每换一次 token 才真的走一次 IPC（保序 await，避免封面请求抢跑）。
 */
const syncMediaSession = async (url: string, headers: Record<string, string>) => {
  const cookie = headers.Cookie || headers.cookie;
  if (!cookie) return;
  // 只认带 music-token 的完整会话。
  // 登录前的预检（`/sys/config`，skipAuth）和中继探测只会带 `mode=relay`，
  // 用它覆盖会话会让后续所有封面/音频变成「有 Cookie 但没 token」→ 401。
  if (!cookie.includes("music-token=")) return;
  const origin = new URL(url).origin;
  const key = `${origin}|${cookie}`;
  if (key === syncedSession) return;
  try {
    await invoke("fnos_set_media_session", { origin, cookie });
    syncedSession = key;
  } catch (error) {
    // 同步失败只影响封面/播放，不该让业务请求失败。
    // 不写入 syncedSession —— 下次请求还要重试，否则一次失败就永久 401。
    console.warn("[Fnos] 同步媒体会话失败", error);
  }
};

/** 桌面端：Rust 侧发请求 */
const tauriTransport: FnosTransport = async (request) => {
  if (request.binary) {
    throw new Error("飞牛音乐媒体二进制通道尚未接入（封面/音频请走 <img>/<audio> 地址）");
  }

  if (mediaProxyReady) await mediaProxyReady;
  await syncMediaSession(request.url, request.headers);

  const response = await invoke<FnosRustResponse>("fnos_request", {
    method: request.method,
    url: request.url,
    headers: request.headers,
    body: request.body ?? null,
  });

  if (response.status >= 300 && response.status < 400) {
    throw new Error(REDIRECT_HINT(response.status, response.location));
  }

  return {
    status: response.status,
    data: response.body,
    contentType: response.contentType || "",
  };
};

/** web：交给 dev server 的 /__fnos 代理 */
const proxyTransport: FnosTransport = async (request) => {
  const target = new URL(request.url);
  const headers: Record<string, string> = {
    "x-fnos-base": target.origin,
    Accept: request.headers.Accept || "*/*",
    "Accept-Language": request.headers["Accept-Language"] || "zh-CN",
  };
  if (request.headers["Content-Type"]) {
    headers["Content-Type"] = request.headers["Content-Type"];
  }
  // 浏览器禁止设置 Cookie 头，token 用自定义头带给代理，由代理拼成 Cookie
  if (request.headers.Authorization) {
    headers["x-fnos-token"] = request.headers.Authorization;
  }

  const response = await fetch(`/__fnos${target.pathname}${target.search}`, {
    method: request.method,
    headers,
    body: request.body,
  });

  return {
    status: response.status,
    data: await response.text(),
    contentType: response.headers.get("content-type") || "",
  };
};

let registered = false;

/** 在 App 启动时调用一次 */
export const registerFnosTransport = () => {
  registerFnosAuthKeys();
  if (registered) return;

  if (isWeb()) {
    // 只有 dev server 带 /__fnos 代理；生产 web 构建没有，直连会被 CORS 拦
    if (import.meta.env.DEV) {
      setFnosTransport(proxyTransport);
      // 封面/音频这类 <img>/<audio> 加不了头，交给代理转发。
      // 必须用绝对地址：应用会把以 `/` 开头的相对路径拼到数据源地址后面
      const mediaProxy = `${window.location.origin}/__fnos`;
      setFnosMediaProxy(mediaProxy);
      console.log("[Fnos] 媒体代理：", mediaProxy);
      registered = true;
      console.log("[Fnos] 已注入 dev 代理传输层（/__fnos）");
      return;
    }
    console.log("[Fnos] web 生产构建不做传输层注入（需服务端反向代理）");
    return;
  }

  setFnosTransport(tauriTransport);
  registered = true;
  console.log("[Fnos] 已注入 Rust 传输层（fnos_request）");

  // 媒体（封面/音频）走本地 127.0.0.1 转发服务，端口要问 Rust 拿。
  // 见 fnos_media.rs：`/fnos/<apiPath><path>?...&__b=<origin>`
  mediaProxyReady = initMediaProxy();
};

/**
 * 取本地媒体服务 origin 并把它设成媒体代理前缀。
 *
 * 这段代码在模块加载期（`https/index.ts` 顶层）就跑，个别环境下 IPC 还没就绪，
 * 所以失败时退避重试几次 —— 拿不到前缀的话封面/音频会退回直连，必然 401。
 */
const initMediaProxy = async (attempt = 0): Promise<void> => {
  try {
    const mediaOrigin = await invoke<string>("get_media_origin");
    if (!mediaOrigin) throw new Error("媒体服务 origin 为空");
    const mediaProxy = `${mediaOrigin}/fnos`;
    setFnosMediaProxy(mediaProxy);
    // 本地媒体服务端口是每次启动随机分配的，而上层列表缓存（5 分钟）里存着
    // 上一进程拼好的封面/音频绝对地址 —— 不清掉会有一段时间封面全 404。
    cacheUtils.clearAll();
    console.log("[Fnos] 媒体代理：", mediaProxy);
  } catch (error) {
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      return initMediaProxy(attempt + 1);
    }
    console.warn("[Fnos] 初始化媒体代理失败（封面/音频将无法加载）", error);
  }
};

/**
 * authx 签名常量（飞牛前端内置的 `authxPrefix` + `clientKey`）。
 *
 * 留空则不带 authx 发请求 —— 实测 1.1.19 的服务端登录/列表/媒体接口都不校验。
 * 拿到常量后两种填法都行：
 *   localStorage.setItem("fnos_authx_prefix", "…"); localStorage.setItem("fnos_client_key", "…");
 * 或构建时注入 VITE_FNOS_AUTHX_PREFIX / VITE_FNOS_CLIENT_KEY。
 */
const registerFnosAuthKeys = () => {
  try {
    const authxPrefix =
      localStorage.getItem("fnos_authx_prefix") ||
      (import.meta.env as Record<string, string | undefined>).VITE_FNOS_AUTHX_PREFIX ||
      "";
    const clientKey =
      localStorage.getItem("fnos_client_key") ||
      (import.meta.env as Record<string, string | undefined>).VITE_FNOS_CLIENT_KEY ||
      "";
    if (!authxPrefix || !clientKey) return;
    setFnosAuthKeys({ authxPrefix, clientKey });
    console.log("[Fnos] 已启用 authx 签名");
  } catch (error) {
    console.warn("[Fnos] 读取 authx 常量失败", error);
  }
};
