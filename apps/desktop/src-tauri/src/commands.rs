use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_os::OsType;

use crate::cache::{CacheManager, TrackMetadata};
use crate::tray::{self, PlayerStateForTray};
use crate::window::{PlayerState, WindowManager};

#[derive(Serialize, Deserialize, Clone)]
pub struct PlayerStatePayload {
    pub is_playing: bool,
    pub track: Option<TrackInfo>,
    pub current_time: Option<f64>,
    pub duration: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TrackInfo {
    pub id: i64,
    pub name: String,
    pub artist: String,
    pub album: Option<String>,
    pub cover: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LyricSettingsPayload {
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub font_size: Option<i32>,
    pub font_color: Option<String>,
    pub stroke_width: Option<i32>,
    pub stroke_color: Option<String>,
    pub shadow: Option<bool>,
    pub always_on_top: Option<bool>,
    pub font_weight: Option<i32>,
    pub lock_position: Option<bool>,
}

pub struct AppState {
    pub cache_manager: Arc<CacheManager>,
    pub player_state: Mutex<PlayerState>,
    pub download_path: Arc<Mutex<String>>,
    pub media_origin: String,
}

#[tauri::command]
pub fn get_device_name() -> String {
    let hostname = tauri_plugin_os::hostname();
    let platform = tauri_plugin_os::type_();

    match platform {
        OsType::Macos => format!("{}（Mac）", hostname),
        OsType::Windows => format!("{}（Windows）", hostname),
        _ => hostname,
    }
}

#[tauri::command]
pub fn get_auto_launch(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
pub fn set_auto_launch(app: AppHandle, enable: bool) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    if enable {
        autolaunch.enable().map_err(|e| e.to_string())
    } else {
        autolaunch.disable().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn select_directory(app: AppHandle) -> Result<Option<String>, String> {
    let result = app.dialog().file().blocking_pick_folder();
    Ok(result.and_then(|p| p.into_path().ok().map(|pb| pb.to_string_lossy().to_string())))
}

#[tauri::command]
pub async fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_directory(path: String) -> Result<String, String> {
    let expanded = if path.starts_with("~") {
        let home = dirs::home_dir()
            .ok_or("Failed to get home directory")?
            .to_string_lossy()
            .to_string();
        path.replacen("~", &home, 1)
    } else {
        path
    };

    if !std::path::Path::new(&expanded).exists() {
        std::fs::create_dir_all(&expanded).map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&expanded)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&expanded)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&expanded)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(expanded)
}

#[tauri::command]
pub async fn cache_check(
    state: State<'_, AppState>,
    track_id: i64,
    source_key: Option<String>,
    original_path: String,
    download_path: String,
    track_type: String,
    album_name: String,
) -> Result<Option<String>, String> {
    let cache_manager = state.cache_manager.clone();
    let origin = state.media_origin.clone();
    let rel = cache_manager.check_cache(
        track_id,
        source_key.as_deref(),
        &original_path,
        &download_path,
        &track_type,
        &album_name,
    )?;
    Ok(rel.map(|p| format!("{}/audio/{}", origin, p)))
}

/// Keeps the backend's notion of the current download path in sync with the
/// renderer. The `media://audio` protocol handler needs it to resolve cached
/// audio files to absolute paths. Persisted to disk so it is known before the
/// renderer has a chance to send it on startup.
#[tauri::command]
pub async fn update_download_path(
    state: State<'_, AppState>,
    app: AppHandle,
    path: String,
) -> Result<(), String> {
    {
        let mut current = state.download_path.lock().map_err(|e| e.to_string())?;
        *current = path.clone();
    }
    if let Ok(app_data_dir) = app.path().app_data_dir() {
        let _ = std::fs::write(app_data_dir.join("download_path.txt"), &path);
    }
    Ok(())
}

#[tauri::command]
pub async fn cache_download(
    state: State<'_, AppState>,
    track_id: i64,
    source_key: Option<String>,
    url: String,
    download_path: String,
    track_type: String,
    album_name: String,
    metadata: TrackMetadata,
    token: Option<String>,
) -> Result<Option<String>, String> {
    let cache_manager = state.cache_manager.clone();
    let origin = state.media_origin.clone();
    let rel = cache_manager
        .download_track(
            track_id,
            source_key.as_deref(),
            &url,
            &download_path,
            &track_type,
            &album_name,
            metadata,
            token.as_deref(),
        )
        .await?;
    Ok(rel.map(|p| format!("{}/audio/{}", origin, p)))
}

#[tauri::command]
pub fn get_media_origin(state: State<'_, AppState>) -> String {
    state.media_origin.clone()
}

#[tauri::command]
pub async fn cache_list(
    state: State<'_, AppState>,
    download_path: String,
    track_type: String,
    source_key: Option<String>,
) -> Result<Vec<TrackMetadata>, String> {
    let cache_manager = state.cache_manager.clone();
    cache_manager.list_cache(&download_path, &track_type, source_key.as_deref())
}

#[tauri::command]
pub async fn cache_get_size(
    state: State<'_, AppState>,
    download_path: String,
) -> Result<u64, String> {
    let cache_manager = state.cache_manager.clone();
    cache_manager.get_total_size(&download_path)
}

#[tauri::command]
pub async fn cache_clear(
    state: State<'_, AppState>,
    download_path: String,
) -> Result<bool, String> {
    let cache_manager = state.cache_manager.clone();
    cache_manager.clear_cache(&download_path)?;
    Ok(true)
}

#[tauri::command]
pub fn minimize_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.minimize();
    }
}

#[tauri::command]
pub fn maximize_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_maximized().unwrap_or(false) {
            let _ = window.unmaximize();
        } else {
            let _ = window.maximize();
        }
    }
}

#[tauri::command]
pub fn close_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.close();
    }
}

#[tauri::command]
pub fn set_always_on_top(app: AppHandle, enable: bool) {
    if let Some(window) = app.get_webview_window("mini") {
        let _ = window.set_always_on_top(enable);
    }
}

#[tauri::command]
pub fn get_player_state(state: State<'_, AppState>) -> Result<PlayerStatePayload, String> {
    let player_state = state.player_state.lock().map_err(|e| e.to_string())?;
    Ok(PlayerStatePayload {
        is_playing: player_state.is_playing,
        track: player_state.track.clone(),
        current_time: player_state.current_time,
        duration: player_state.duration,
    })
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub fn create_lyric_window(
    app: AppHandle,
    settings: Option<LyricSettingsPayload>,
) -> Result<(), String> {
    let window_manager = WindowManager::new(&app);
    window_manager.create_lyric_window(settings)
}

#[tauri::command]
pub fn create_mini_window(app: AppHandle) -> Result<(), String> {
    let window_manager = WindowManager::new(&app);
    window_manager.create_mini_window()
}

#[tauri::command]
pub fn close_lyric_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("lyric") {
        let _ = window.close();
    }
}

#[tauri::command]
pub fn set_ignore_mouse_events(app: AppHandle, ignore: bool) {
    if let Some(window) = app.get_webview_window("lyric") {
        let _ = window.set_ignore_cursor_events(ignore);
    }
}

#[tauri::command]
pub fn update_lyric_position(app: AppHandle, x: i32, y: i32) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("lyric") {
        window
            .set_position(tauri::PhysicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn update_player_state(app: AppHandle, state: PlayerStateForTray) {
    tray::update_player_state(&app, state);
}

#[tauri::command]
pub fn update_tray_lyric(app: AppHandle, text: Option<String>) {
    tray::update_tray_lyric(&app, text);
}

/// Alias used by the renderer (`invoke("update_lyric", { currentLyric })`) so the
/// macOS lyric tray mirrors the desktop-lyric text. Mirrors Electron's
/// `ipcMain.on("lyric:update")` payload shape.
#[tauri::command]
pub fn update_lyric(app: AppHandle, current_lyric: Option<String>) {
    tray::update_tray_lyric(&app, current_lyric);
}

#[tauri::command]
pub fn set_minimize_to_tray(app: AppHandle, enable: bool) {
    app.manage(MinimizeToTrayFlag(enable));
}

pub struct MinimizeToTrayFlag(pub bool);
