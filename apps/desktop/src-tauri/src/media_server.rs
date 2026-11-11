use std::io::SeekFrom;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use percent_encoding::percent_decode_str;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio_util::io::ReaderStream;

use crate::cache::expand_tilde;
use crate::fnos_media::FnosSessions;
use crate::protocol::{mime_for, parse_range};

/// A local, loopback-only HTTP server that streams cached audio files to the
/// webview's `<audio>` element (AVPlayer).
///
/// This exists because AVPlayer cannot stream from Tauri's custom `media://`
/// protocol (its responder delivers the full body at once, and AVPlayer bypasses
/// `WKURLSchemeHandler` anyway). HTTP is the one transport AVPlayer streams
/// natively, with range requests - so cached tracks can play progressively
/// ("边下边听") instead of buffering the whole file first.
#[derive(Clone)]
struct MediaState {
    download_path: Arc<Mutex<String>>,
    /// 飞牛音乐的会话 Cookie，`/fnos/*` 转发用（见 `fnos_media.rs`）
    fnos_sessions: FnosSessions,
}

impl axum::extract::FromRef<MediaState> for FnosSessions {
    fn from_ref(state: &MediaState) -> Self {
        state.fnos_sessions.clone()
    }
}

/// Binds a loopback listener, spawns the server on the Tauri async runtime, and
/// returns the origin (`http://127.0.0.1:<port>`) the renderer should use.
pub fn start(
    download_path: Arc<Mutex<String>>,
    fnos_sessions: FnosSessions,
) -> Result<String, String> {
    // Bind on the calling (main) thread so we can return the port synchronously.
    // `set_nonblocking` is required for `TcpListener::from_std` later.
    let listener =
        std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| format!("bind: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("addr: {}", e))?
        .port();
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("nonblock: {}", e))?;

    let app = Router::new()
        .route("/audio/{*rel}", get(serve_audio))
        // 飞牛音乐：封面 / 音频流转发（带 Cookie + Range），见 fnos_media.rs
        .route("/fnos/{*rel}", get(crate::fnos_media::serve))
        .with_state(MediaState {
            download_path,
            fnos_sessions,
        });

    // `from_std` (and the accept loop) need a Tokio reactor, which only exists
    // inside the runtime - so do it from within the spawned task, not here.
    tauri::async_runtime::spawn(async move {
        match tokio::net::TcpListener::from_std(listener) {
            Ok(tokio_listener) => {
                let _ = axum::serve(tokio_listener, app).await;
            }
            Err(e) => {
                eprintln!("[media_server] from_std failed: {}", e);
            }
        }
    });

    Ok(format!("http://127.0.0.1:{}", port))
}

/// `GET /audio/<rel>` -> streams `<downloadPath>/<rel>` with range support.
async fn serve_audio(State(st): State<MediaState>, req: Request) -> Response {
    let dp = st
        .download_path
        .lock()
        .map(|s| s.clone())
        .unwrap_or_default();
    let expanded = expand_tilde(&dp).unwrap_or_else(|_| dp.clone());

    // Parse the path straight off the raw URI so we control percent-decoding
    // (axum's `Path` extractor would decode for us, risking double-decoding).
    let rel = req
        .uri()
        .path()
        .strip_prefix("/audio/")
        .unwrap_or("")
        .trim_start_matches('/');
    let decoded = percent_decode_str(rel).decode_utf8_lossy().to_string();
    let file_path = PathBuf::from(expanded).join(&decoded);

    let metadata = match tokio::fs::metadata(&file_path).await {
        Ok(m) if m.is_file() => m,
        _ => return StatusCode::NOT_FOUND.into_response(),
    };
    let total = metadata.len();
    let mime = mime_for(&file_path);

    let range = req.headers().get("range").and_then(|v| v.to_str().ok());
    if let Some(span) = range.and_then(|r| parse_range(r, total)) {
        let mut file = match tokio::fs::File::open(&file_path).await {
            Ok(f) => f,
            Err(_) => return StatusCode::NOT_FOUND.into_response(),
        };
        if file.seek(SeekFrom::Start(span.start)).await.is_err() {
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
        // `take` caps the reader to the requested range; ReaderStream pumps it
        // to the client in chunks so playback starts before the whole file loads.
        let stream = ReaderStream::new(file.take(span.length));
        return Response::builder()
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_TYPE, mime)
            .header(header::ACCEPT_RANGES, "bytes")
            .header(
                header::CONTENT_RANGE,
                format!("bytes {}-{}/{}", span.start, span.start + span.length - 1, total),
            )
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(Body::from_stream(stream))
            .unwrap();
    }

    let file = match tokio::fs::File::open(&file_path).await {
        Ok(f) => f,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };
    let stream = ReaderStream::new(file);
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(Body::from_stream(stream))
        .unwrap()
}
