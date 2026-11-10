//! 飞牛音乐（fnOS trim.music）的原生 HTTP 通道。
//!
//! 为什么不直接用 `tauri-plugin-http`：
//!
//! 1. 插件有 URL **scope 校验**，capability 里少写一条 pattern（尤其是带端口的
//!    `http://host:5666/...`），请求就在 Rust 侧被拒，前端只看到
//!    `url not allowed on the configured scope`，而且因为走 IPC、不经浏览器网络栈，
//!    devtools 的 Network 面板里**什么都看不到**。
//! 2. 插件按 fetch 规范过滤 forbidden header，飞牛 FN Connect 中继必须的
//!    `Cookie: mode=relay` 会被静默丢掉（需要 `unsafe-headers` 特性才放行）。
//! 3. 飞牛网关不返回 CORS 头，未登录时是 **302 到 SPA 登录页**；插件默认跟随重定向，
//!    前端拿到一坨 HTML，错误信息完全没有指向性。
//!
//! 这里直接走 reqwest：Cookie 原样透传、不跟随重定向（把 302 / Location 暴露给前端），
//! 网络层错误也带上具体原因，排查时一眼能看出卡在哪一步。

use std::collections::HashMap;
use std::time::Duration;

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FnosHttpResponse {
    /// HTTP 状态码（302 / 401 / 400 都原样回传，由前端翻译）
    pub status: u16,
    pub body: String,
    pub content_type: String,
    /// 未跟随重定向时上游给的跳转目标，用于识别「中继没放行」
    pub location: Option<String>,
}

/// 发一个飞牛网关请求。
///
/// - `headers` 由前端拼好（含 `Cookie: mode=relay; music-token=…`），原样透传
/// - `body` 是已经序列化好的 JSON 字符串
/// - 不跟随重定向：302 说明中继/会话有问题，比跟随成 HTML 更好定位
#[tauri::command]
pub async fn fnos_request(
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<FnosHttpResponse, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|e| format!("初始化 HTTP 客户端失败：{e}"))?;

    let parsed = reqwest::Method::from_bytes(method.to_uppercase().as_bytes())
        .map_err(|e| format!("不支持的请求方法 {method}：{e}"))?;

    let mut request = client.request(parsed, url.as_str());
    for (name, value) in headers.iter() {
        if value.is_empty() {
            continue;
        }
        request = request.header(name.as_str(), value.as_str());
    }
    if let Some(payload) = body {
        request = request.body(payload);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("请求 {url} 失败：{e}"))?;

    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let location = response
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let body = response
        .text()
        .await
        .map_err(|e| format!("读取 {url} 响应失败：{e}"))?;

    Ok(FnosHttpResponse {
        status,
        body,
        content_type,
        location,
    })
}
