use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlayerStateForTray {
    pub is_playing: bool,
    pub track_name: Option<String>,
    pub track_artist: Option<String>,
    /// 当前歌曲封面 URL（Windows 任务栏缩略图用，其它端忽略）。
    #[serde(default)]
    pub cover: Option<String>,
}

// Global state so both update_player_state and update_tray_lyric can
// compute the correct trayLyric title (lyric takes priority over track name).
static PLAYER_STATE: OnceLock<Mutex<PlayerStateForTray>> = OnceLock::new();
static CURRENT_LYRIC: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn player_state_lock() -> &'static Mutex<PlayerStateForTray> {
    PLAYER_STATE.get_or_init(|| Mutex::new(PlayerStateForTray::default()))
}

fn current_lyric_lock() -> &'static Mutex<Option<String>> {
    CURRENT_LYRIC.get_or_init(|| Mutex::new(None))
}

/// Compute the trayLyric title: current lyric line takes priority,
/// falling back to "name - artist", then empty.
/// Mirrors Electron's `lyric:update` handler:
/// `currentLyric || (playerState.track ? `${name} - ${artist}` : "")`
fn compute_lyric_title() -> String {
    let lyric = current_lyric_lock().lock().unwrap().clone();
    if let Some(l) = &lyric {
        if !l.is_empty() {
            return l.clone();
        }
    }
    let state = player_state_lock().lock().unwrap().clone();
    match (&state.track_name, &state.track_artist) {
        (Some(name), Some(artist)) if !name.is_empty() && !artist.is_empty() => {
            format!("{} - {}", name, artist)
        }
        (Some(name), _) if !name.is_empty() => name.clone(),
        _ => String::new(),
    }
}

// ============================================================================
// Setup
// ============================================================================

pub fn setup_tray(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // Create in order: next → play → prev → main → lyric.
        // macOS arranges status items right-to-left by creation order,
        // so visual order from left to right is: lyric | main | prev | play | next
        // Lyric is leftmost (closest to app menus) for a centered look.
        build_transport_tray(app, "tray_next")?;
        build_transport_tray(app, "tray_play")?;
        build_transport_tray(app, "tray_prev")?;
        build_main_tray(app)?;
        build_lyric_tray(app)?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        build_main_tray(app)?;
    }

    Ok(())
}

// ============================================================================
// macOS-only trays (lyric + transport buttons)
// ============================================================================

#[cfg(target_os = "macos")]
fn build_lyric_tray(app: &AppHandle) -> Result<(), String> {
    // 1x1 transparent RGBA pixel — mirrors Electron's emptyImg base64 PNG.
    let transparent = Image::new_owned(vec![0, 0, 0, 0], 1, 1);
    TrayIconBuilder::with_id("tray_lyric")
        .icon(transparent)
        .title("AudioDock")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                emit_event(tray.app_handle(), "lyric:toggle");
            }
        })
        .build(app)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn build_transport_tray(app: &AppHandle, id: &str) -> Result<(), String> {
    let icon_bytes: &[u8] = match id {
        "tray_next" => include_bytes!("../../public/next.png"),
        "tray_play" => include_bytes!("../../public/play.png"),
        "tray_prev" => include_bytes!("../../public/previous.png"),
        _ => return Err(format!("unknown transport tray: {}", id)),
    };
    let icon = Image::from_bytes(icon_bytes).map_err(|e| e.to_string())?;
    TrayIconBuilder::with_id(id)
        .icon(icon)
        .icon_as_template(true)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(handle_transport_tray_event)
        .build(app)
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================================================
// Main tray (all platforms)
// ============================================================================

fn build_main_tray(app: &AppHandle) -> Result<(), String> {
    let menu = build_main_menu(app)?;

    #[cfg(target_os = "macos")]
    {
        let icon = Image::from_bytes(include_bytes!("../../public/mini_logo.png"))
            .map_err(|e| e.to_string())?;
        TrayIconBuilder::with_id("tray_main")
            .icon(icon)
            .icon_as_template(true)
            .menu(&menu)
            .on_menu_event(handle_menu_event)
            .on_tray_icon_event(|tray, event| {
                if matches!(
                    event,
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    }
                ) {
                    show_main_window(tray.app_handle());
                }
            })
            .build(app)
            .map_err(|e| e.to_string())?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let icon = Image::from_bytes(include_bytes!("../../public/logo.png"))
            .map_err(|e| e.to_string())?;
        TrayIconBuilder::with_id("tray_main")
            .icon(icon)
            .tooltip("AudioDock")
            .menu(&menu)
            .on_menu_event(handle_menu_event)
            .on_tray_icon_event(|tray, event| {
                if matches!(
                    event,
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    }
                ) {
                    show_main_window(tray.app_handle());
                }
            })
            .build(app)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

// ============================================================================
// Dynamic menu builder (mirrors Electron's updatePlayerUI menu section)
// ============================================================================

fn build_main_menu(app: &AppHandle) -> Result<tauri::menu::Menu<tauri::Wry>, String> {
    let state = player_state_lock().lock().unwrap().clone();
    let map_err = |e: tauri::Error| e.to_string();

    let mut builder = MenuBuilder::new(app);

    // If a track is playing, show track info (disabled) + transport controls.
    if state.track_name.is_some() {
        let name = state.track_name.as_deref().unwrap_or("");
        let artist = state.track_artist.as_deref().unwrap_or("");

        let track_label = MenuItemBuilder::new(format!("♫ {}", name))
            .enabled(false)
            .build(app)
            .map_err(map_err)?;
        let artist_label = MenuItemBuilder::new(format!("   {}", artist))
            .enabled(false)
            .build(app)
            .map_err(map_err)?;
        let sep1 = PredefinedMenuItem::separator(app).map_err(map_err)?;
        let prev = MenuItemBuilder::with_id("prev", "⏮ 上一曲")
            .build(app)
            .map_err(map_err)?;
        let play_label = if state.is_playing { "⏸ 暂停" } else { "▶️ 播放" };
        let play_pause = MenuItemBuilder::with_id("play_pause", play_label)
            .build(app)
            .map_err(map_err)?;
        let next = MenuItemBuilder::with_id("next", "⏭ 下一曲")
            .build(app)
            .map_err(map_err)?;
        let sep2 = PredefinedMenuItem::separator(app).map_err(map_err)?;

        builder = builder
            .item(&track_label)
            .item(&artist_label)
            .item(&sep1)
            .item(&prev)
            .item(&play_pause)
            .item(&next)
            .item(&sep2);
    }

    let show_main = MenuItemBuilder::with_id("show_main", "打开播放器")
        .build(app)
        .map_err(map_err)?;
    let quit = MenuItemBuilder::with_id("quit", "退出")
        .build(app)
        .map_err(map_err)?;

    builder = builder.item(&show_main).item(&quit);
    builder.build().map_err(map_err)
}

// ============================================================================
// Event handlers
// ============================================================================

/// Click handler for prev / play / next trays.
fn handle_transport_tray_event(tray: &tauri::tray::TrayIcon, event: TrayIconEvent) {
    if !matches!(
        event,
        TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        }
    ) {
        return;
    }
    let app = tray.app_handle();
    match tray.id().as_ref() {
        "tray_prev" => emit_event(app, "player:prev"),
        "tray_next" => emit_event(app, "player:next"),
        "tray_play" => emit_event(app, "player:toggle"),
        _ => {}
    }
}

/// Menu event handler for trayMain's right-click menu.
fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    match event.id.0.as_str() {
        "show_main" => show_main_window(app),
        "quit" => app.exit(0),
        "play_pause" => emit_event(app, "player:toggle"),
        "prev" => emit_event(app, "player:prev"),
        "next" => emit_event(app, "player:next"),
        _ => {}
    }
}

// ============================================================================
// State update functions (called from commands.rs)
// ============================================================================

/// Mirrors Electron's `updatePlayerUI()`:
/// 1. Rebuild trayMain right-click menu with current track info + Chinese labels
/// 2. Swap trayPlay icon (play.png ↔ pause.png)
/// 3. Update trayLyric title (lyric takes priority, else "name - artist")
pub fn update_player_state(app: &AppHandle, state: PlayerStateForTray) {
    *player_state_lock().lock().unwrap() = state.clone();

    // Windows: 同步任务栏缩略图（封面 + 播控按钮）
    #[cfg(target_os = "windows")]
    crate::taskbar_thumb::sync(app, state.is_playing, state.cover.clone());

    // 1. Rebuild trayMain menu
    if let Ok(menu) = build_main_menu(app) {
        if let Some(tray) = app.tray_by_id("tray_main") {
            let _ = tray.set_menu(Some(menu));
        }
    }

    // 2. macOS: swap trayPlay icon
    #[cfg(target_os = "macos")]
    {
        if let Some(tray) = app.tray_by_id("tray_play") {
            let bytes: &[u8] = if state.is_playing {
                include_bytes!("../../public/pause.png")
            } else {
                include_bytes!("../../public/play.png")
            };
            if let Ok(img) = Image::from_bytes(bytes) {
                let _ = tray.set_icon(Some(img));
                let _ = tray.set_icon_as_template(true);
            }
        }

        // 3. macOS: update trayLyric title
        if let Some(tray) = app.tray_by_id("tray_lyric") {
            let title = compute_lyric_title();
            let _ = tray.set_title(if title.is_empty() { None } else { Some(&title) });
        }
    }
}

/// Mirrors Electron's `ipcMain.on("lyric:update")`:
/// `trayLyric.setTitle(currentLyric || (track ? name-artist : ""))`
pub fn update_tray_lyric(app: &AppHandle, text: Option<String>) {
    *current_lyric_lock().lock().unwrap() = text;

    #[cfg(target_os = "macos")]
    {
        if let Some(tray) = app.tray_by_id("tray_lyric") {
            let title = compute_lyric_title();
            let _ = tray.set_title(if title.is_empty() { None } else { Some(&title) });
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
    }
}

// ============================================================================
// Helpers
// ============================================================================

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub(crate) fn emit_event(app: &AppHandle, event: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit(event, ());
    }
}
