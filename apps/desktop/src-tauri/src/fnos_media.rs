//! 飞牛音乐（fnOS trim.music）媒体代理 —— 桌面端。
//!
//! `<img src>` / `<audio src>` 带不了请求头，而飞牛的 `/static/cover`、
//! `/track/stream` 只认 `Cookie: music-token=…`（中继还要 `mode=relay`），
//! 直连一定 401 / 302。
//!
//! web 版由 vite dev 代理（`vite-plugin-fnos-proxy.ts`）代转；桌面端没有那层中间件，
//! 这里在已有的本地媒体服务器（见 `media_server.rs`）上挂一条 `/fnos/{*rel}` 路由，
//! 完成同样的事：
//!
//! ```text
//! http://127.0.0.1:<port>/fnos/music/api/v1/static/cover?coverId=…&size=…&__b=https%3A%2F%2Fhost
//! ```
//!
//! - `__b` 是上游 origin，由前端 `buildMediaUrl()` 拼进来，转发前从 query 摘掉。
//! - Cookie 由前端在业务请求时同步过来（`fnos_set_media_session`），按 origin 存，
//!   **不写进 URL** —— 否则封面地址会被应用缓存进 localStorage，重新登录后仍是旧
//!   token，永远 401（web 版踩过）。
//! - `Range` 头原样透传、响应体流式回灌，保证 AVPlayer 能边下边播。
//!
//! 为什么不走自定义协议（`fnos-media://`）：AVPlayer 无法从自定义协议流式播放，
//! 而 http://127.0.0.1 是它原生支持的传输方式（`media_server.rs` 就是为此存在的）。

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use percent_encoding::percent_decode_str;

/// origin -> `Cookie` 头原文（如 `mode=relay; music-token=…`）
pub type FnosSessions = Arc<Mutex<HashMap<String, String>>>;

pub fn new_sessions() -> FnosSessions {
    Arc::new(Mutex::new(HashMap::new()))
}

/// 写入/清除某个 origin 的会话 Cookie（cookie 为空即清除）
pub fn set_session(sessions: &FnosSessions, origin: &str, cookie: &str) {
    let key = origin.trim().trim_end_matches('/').to_string();
    if key.is_empty() {
        return;
    }
    if let Ok(mut map) = sessions.lock() {
        if cookie.trim().is_empty() {
            map.remove(&key);
        } else {
            // 只有 `mode=relay` 的「弱会话」（登录前预检、中继探测）不能覆盖
            // 已有的完整会话，否则封面/音频会拿到「有 Cookie 没 token」→ 401。
            let weak = !cookie.contains("music-token=");
            let has_strong = map
                .get(&key)
                .map(|existing| existing.contains("music-token="))
                .unwrap_or(false);
            if weak && has_strong {
                return;
            }
            eprintln!("[fnos-media] 同步会话 origin={key} cookie_len={}", cookie.len());
            map.insert(key, cookie.to_string());
        }
    }
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            // 媒体地址不跟随重定向：302 说明中继/会话有问题，直接回 401 更好定位
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

/// `GET /fnos/{*rel}`：把请求转发到飞牛网关，带 Cookie 与 Range。
pub async fn serve(State(sessions): State<FnosSessions>, req: Request) -> Response {
    let uri = req.uri();
    let rel = uri
        .path()
        .strip_prefix("/fnos/")
        .unwrap_or("")
        .trim_start_matches('/')
        .to_string();
    if rel.is_empty() {
        return (StatusCode::BAD_REQUEST, "缺少媒体路径").into_response();
    }

    // 从 query 里取出 __b（上游 origin），其余参数原样保留
    let mut origin = String::new();
    let mut kept: Vec<&str> = Vec::new();
    for part in uri.query().unwrap_or("").split('&') {
        if part.is_empty() {
            continue;
        }
        match part.strip_prefix("__b=") {
            Some(value) => {
                origin = percent_decode_str(value).decode_utf8_lossy().to_string();
            }
            None => kept.push(part),
        }
    }
    let origin = origin.trim_end_matches('/').to_string();
    if origin.is_empty() {
        return (StatusCode::BAD_REQUEST, "缺少 __b 参数（上游地址）").into_response();
    }
    if !origin.starts_with("http://") && !origin.starts_with("https://") {
        return (StatusCode::BAD_REQUEST, "__b 不是合法的上游地址").into_response();
    }

    let query = kept.join("&");
    let upstream = if query.is_empty() {
        format!("{origin}/{rel}")
    } else {
        format!("{origin}/{rel}?{query}")
    };

    let cookie = sessions
        .lock()
        .ok()
        .and_then(|map| map.get(&origin).cloned())
        .unwrap_or_default();
    // 只转发到「已同步过会话」的 origin：这个回环端口对任意本地页面可见，
    // 不能让别人把 __b 指到别处、借我们的 Cookie 去读飞牛账号里的东西。
    if cookie.is_empty() {
        eprintln!("[fnos-media] {} 无会话（origin={}），拒绝转发", rel, origin);
        return (
            StatusCode::FORBIDDEN,
            "该地址还没有同步飞牛会话，先发一次业务请求再来取媒体",
        )
            .into_response();
    }

    let range = req
        .headers()
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());

    let mut builder = client()
        .get(&upstream)
        .header(header::ACCEPT, "*/*")
        .header("Accept-Language", "zh-CN")
        .header(header::COOKIE, cookie);
    if let Some(ref range) = range {
        builder = builder.header(header::RANGE, range);
    }

    let response = match builder.send().await {
        Ok(resp) => resp,
        Err(err) => {
            eprintln!("[fnos-media] 请求上游失败：{upstream} -> {err}");
            return (
                StatusCode::BAD_GATEWAY,
                format!("请求飞牛媒体失败：{err}"),
            )
                .into_response();
        }
    };

    let status = response.status();
    eprintln!(
        "[fnos-media] {} range={:?} -> {}",
        rel,
        range,
        status.as_u16()
    );
    if status.is_redirection() {
        let location = response
            .headers()
            .get(header::LOCATION)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("");
        eprintln!("[fnos-media] 上游重定向（会话失效/中继未放行）：{upstream} -> {location}");
        return (
            StatusCode::UNAUTHORIZED,
            "飞牛媒体返回重定向，会话已失效或中继未放行",
        )
            .into_response();
    }
    if !status.is_success() {
        let code = StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
        let body = response.text().await.unwrap_or_default();
        let snippet: String = body.chars().take(300).collect();
        if status.as_u16() != 404 {
            eprintln!("[fnos-media] 上游 {} {} -> {}", status.as_u16(), upstream, snippet);
        }
        return (code, format!("飞牛媒体请求失败：HTTP {} {}", status.as_u16(), snippet))
            .into_response();
    }

    let upstream_status = StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::OK);
    let mut out = Response::builder().status(upstream_status);
    for name in [
        header::CONTENT_TYPE,
        header::CONTENT_LENGTH,
        header::CONTENT_RANGE,
        header::ACCEPT_RANGES,
        header::CACHE_CONTROL,
        header::ETAG,
        header::LAST_MODIFIED,
    ] {
        if let Some(value) = response.headers().get(&name) {
            if let Ok(text) = value.to_str() {
                out = out.header(name, text.to_string());
            }
        }
    }

    out.header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(Body::from_stream(response.bytes_stream()))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}
