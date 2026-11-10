import {
  setFnosAuthKeys,
  setFnosMediaProxy,
  setFnosTransport,
  type FnosTransport,
} from "@soundx/services";
import { invoke } from "@tauri-apps/api/core";
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

/** 桌面端：Rust 侧发请求 */
const tauriTransport: FnosTransport = async (request) => {
  if (request.binary) {
    throw new Error("飞牛音乐媒体二进制通道尚未接入（封面/音频请走 <img>/<audio> 地址）");
  }

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
