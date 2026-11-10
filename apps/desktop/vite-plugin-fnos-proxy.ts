import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

/**
 * 飞牛音乐（fnOS trim.music）开发代理。
 *
 * 为什么需要它：飞牛网关**不返回任何 CORS 响应头**，而且中继地址
 * （`*.fnos.net` / `*.5ddd.com`）要求每个请求带 `Cookie: mode=relay`。
 * 浏览器里既跨不了域、也设不了 Cookie 头，所以 web 版本没法直连。
 *
 * 这个中间件把请求接到 dev server 上转发：
 *
 * ```
 * 浏览器  GET /__fnos/music/api/v1/track/list?page=1
 *            x-fnos-base: https://mmdctjj.fnos.net
 *            x-fnos-token: <userToken>
 *         ↓
 * dev 服务  GET https://mmdctjj.fnos.net/music/api/v1/track/list?page=1
 *            Cookie: mode=relay; music-token=<userToken>
 * ```
 *
 * `<img>` / `<audio>` 这种加不了请求头的场景，用 query 传：`?__b=<origin>&__t=<token>`。
 *
 * 只在 `vite dev` 生效（`apply: "serve"`），生产构建不受影响。
 */
const PREFIX = "/__fnos";
const RELAY_HOST_PATTERN = /\.(fnos\.net|5ddd\.com)$/i;

/**
 * origin → 会话 token。
 *
 * 媒体请求（`<img>` / `<audio>`）加不了请求头，也不适合把 token 写进 URL
 * （会被应用缓存进 localStorage，重新登录后 token 变化就 401 了）。
 * 所以这里记住每个数据源最近一次 API 请求带的 token，媒体请求优先取它。
 */
const sessions = new Map<string, string>();

/** 上游 3xx 不跟随：把重定向变成可读的 JSON 错误，避免浏览器跟着跳到飞牛登录页 */
const REDIRECT_ENVELOPE = (status: number, location?: string) =>
  JSON.stringify({
    code: -302,
    msg: `飞牛音乐返回重定向（HTTP ${status}）${
      location ? ` → ${location}` : ""
    }，通常是中继未放行（缺 Cookie: mode=relay）或会话已失效`,
    data: null,
  });

const readBody = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

const forwardHeaders = (req: IncomingMessage, token: string | undefined, base: URL) => {
  const headers = new Headers();
  // 只透传真正需要的头；Host / Origin / Referer / sec-* 这些带过去会被上游当成跨站请求
  const allow = ["accept", "accept-language", "content-type", "range", "if-none-match"];
  allow.forEach((name) => {
    const value = req.headers[name];
    if (typeof value === "string" && value) headers.set(name, value);
  });
  if (!headers.has("accept")) headers.set("accept", "*/*");

  const cookies: string[] = [];
  if (RELAY_HOST_PATTERN.test(base.hostname)) cookies.push("mode=relay");
  if (token) cookies.push(`music-token=${encodeURIComponent(token)}`);
  if (cookies.length) headers.set("cookie", cookies.join("; "));
  return headers;
};

export function fnosProxyPlugin(): Plugin {
  return {
    name: "audiodock-fnos-proxy",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const rawUrl = req.url || "";
        if (rawUrl !== PREFIX && !rawUrl.startsWith(`${PREFIX}/`)) return next();

        const parsed = new URL(rawUrl, "http://localhost");
        const path = parsed.pathname.slice(PREFIX.length) || "/";

        const headerBase = req.headers["x-fnos-base"];
        const baseRaw =
          parsed.searchParams.get("__b") || (typeof headerBase === "string" ? headerBase : "");
        if (!baseRaw) {
          res.statusCode = 400;
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ code: -400, msg: "缺少 x-fnos-base 或 __b 参数" }));
          return;
        }

        let base: URL;
        try {
          base = new URL(baseRaw);
        } catch {
          res.statusCode = 400;
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ code: -400, msg: `服务器地址不合法：${baseRaw}` }));
          return;
        }
        if (base.protocol !== "http:" && base.protocol !== "https:") {
          res.statusCode = 400;
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ code: -400, msg: `不支持的协议：${base.protocol}` }));
          return;
        }

        const headerToken = req.headers["x-fnos-token"];
        const authorization = req.headers.authorization;
        const explicitToken =
          parsed.searchParams.get("__t") ||
          (typeof headerToken === "string" ? headerToken : "") ||
          (typeof authorization === "string" ? authorization.replace(/^Bearer\s+/i, "") : "");

        // API 请求带 token 时记住它；媒体请求（没带 token）复用上一次的会话
        if (explicitToken) sessions.set(base.origin, explicitToken);
        const token = explicitToken || sessions.get(base.origin) || "";

        // 把内部参数摘掉，其余 query 原样转发
        const query = new URLSearchParams(parsed.searchParams);
        query.delete("__b");
        query.delete("__t");
        const search = query.toString();
        const target = `${base.origin}${path}${search ? `?${search}` : ""}`;

        const method = (req.method || "GET").toUpperCase();
        const body = method === "GET" || method === "HEAD" ? undefined : await readBody(req);

        try {
          const upstream = await fetch(target, {
            method,
            headers: forwardHeaders(req, token || undefined, base),
            body,
            redirect: "manual",
          });

          if (upstream.status >= 300 && upstream.status < 400) {
            res.statusCode = 200;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(
              REDIRECT_ENVELOPE(upstream.status, upstream.headers.get("location") || undefined),
            );
            return;
          }

          res.statusCode = upstream.status;
          ["content-type", "content-length", "content-range", "accept-ranges", "cache-control"].forEach(
            (name) => {
              const value = upstream.headers.get(name);
              if (value) res.setHeader(name, value);
            },
          );

          const contentType = upstream.headers.get("content-type") || "";
          // JSON / 文本直接读完再回，二进制（封面、音频分片）边读边写
          if (/json|text|xml|javascript/i.test(contentType) || !contentType) {
            res.end(Buffer.from(await upstream.arrayBuffer()));
            return;
          }
          const buffer = Buffer.from(await upstream.arrayBuffer());
          res.setHeader("content-length", String(buffer.byteLength));
          res.end(buffer);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          server.config.logger.warn(`[fnos-proxy] ${method} ${target} 失败：${detail}`);
          res.statusCode = 200;
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.end(
            JSON.stringify({
              code: -500,
              msg: `请求飞牛音乐失败：${detail}（目标 ${target}）`,
              data: null,
            }),
          );
        }
      });
    },
  };
}
