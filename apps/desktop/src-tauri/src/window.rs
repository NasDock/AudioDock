use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::commands::{LyricSettingsPayload, TrackInfo};

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct PlayerState {
    pub is_playing: bool,
    pub track: Option<TrackInfo>,
    pub current_time: Option<f64>,
    pub duration: Option<f64>,
}

pub struct WindowManager<'a> {
    app: &'a AppHandle,
}

impl<'a> WindowManager<'a> {
    pub fn new(app: &'a AppHandle) -> Self {
        Self { app }
    }

    // mini 窗口位置持久化文件（与 download_path.txt 同目录模式）
    fn mini_position_path(&self) -> Option<std::path::PathBuf> {
        self.app
            .path()
            .app_data_dir()
            .ok()
            .map(|d| d.join("mini_window_pos.json"))
    }

    // 读取上次保存的 mini 窗口位置（物理像素）。
    // 校验左上角仍落在某个显示器内，防止拔掉外接屏/改分辨率后窗口恢复到不可见区域。
    fn load_mini_position(&self) -> Option<tauri::PhysicalPosition<i32>> {
        let data = std::fs::read_to_string(self.mini_position_path()?).ok()?;
        let v: serde_json::Value = serde_json::from_str(&data).ok()?;
        let x = v.get("x")?.as_i64()? as i32;
        let y = v.get("y")?.as_i64()? as i32;
        let monitors = self.app.available_monitors().ok()?;
        let on_screen = monitors.iter().any(|m| {
            let mp = m.position();
            let ms = m.size();
            x >= mp.x && y >= mp.y && x < mp.x + ms.width as i32 && y < mp.y + ms.height as i32
        });
        if on_screen {
            Some(tauri::PhysicalPosition::new(x, y))
        } else {
            None
        }
    }

    pub fn create_lyric_window(&self, settings: Option<LyricSettingsPayload>) -> Result<(), String> {
        eprintln!("[tauri] create_lyric_window called, existing={}", self.app.get_webview_window("lyric").is_some());

        // If a lyric window already exists, just show + focus it. Re-building
        // every time causes the "first toggle shows, second hides, third never
        // reappears" bug because the rebuild races with the prior close event.
        if let Some(existing) = self.app.get_webview_window("lyric") {
            let _ = existing.show();
            let _ = existing.set_focus();
            let _ = existing.unminimize();
            #[cfg(target_os = "macos")]
            {
                let _ = existing.set_always_on_top(true);
            }
            eprintln!("[tauri] lyric window was existing, called show()");
            return Ok(());
        }

        let mut builder =
            WebviewWindowBuilder::new(self.app, "lyric", WebviewUrl::App("index.html#/lyric".into()))
                .title("Lyric")
                .inner_size(800.0, 120.0)
                .decorations(false)
                .transparent(true)
                .always_on_top(true)
                .skip_taskbar(true)
                .resizable(true)
                .visible(true)
                .center();

        if let Some(s) = settings {
            if let (Some(x), Some(y)) = (s.x, s.y) {
                builder = builder.position(x as f64, y as f64);
            }
        }

        let window = builder.build().map_err(|e| e.to_string())?;
        eprintln!("[tauri] lyric window built: {:?}", window.label());

        // Ensure the window is visible — `.visible(true)` on the builder can be
        // overridden by webview state on macOS; force a show() after build.
        match window.show() {
            Ok(()) => eprintln!("[tauri] lyric window show() succeeded"),
            Err(e) => eprintln!("[tauri] lyric window show() failed: {}", e),
        }
        match window.set_focus() {
            Ok(()) => eprintln!("[tauri] lyric window set_focus() succeeded"),
            Err(e) => eprintln!("[tauri] lyric window set_focus() failed: {}", e),
        }

        #[cfg(target_os = "macos")]
        {
            match window.set_always_on_top(true) {
                Ok(()) => eprintln!("[tauri] lyric window set_always_on_top succeeded"),
                Err(e) => eprintln!("[tauri] lyric window set_always_on_top failed: {}", e),
            }
        }

        Ok(())
    }

    pub fn create_mini_window(&self) -> Result<(), String> {
        // 已存在就 show + focus 复用，不要 close 后立刻以同 label 重建 ——
        // close 事件异步处理，重建会与之竞争（label 冲突 / 新 webview 加载异常）。
        if let Some(existing) = self.app.get_webview_window("mini") {
            let _ = existing.show();
            let _ = existing.set_focus();
            let _ = existing.unminimize();
            let _ = existing.set_always_on_top(true);
            return Ok(());
        }

        let saved_pos = self.load_mini_position();

        // 背景与主窗口对齐：
        // - macOS：透明窗口 + popover 材质（毛玻璃），同主窗口 tauri.conf.json 的 windowEffects，
        //   前端容器背景设为透明让 vibrancy 透出。
        // - Windows/Linux：不透明纯色窗口（WebView2 透明 + 无装饰在 win 上会直接透视桌面），
        //   背景色由前端 token.colorBgContainer 填充，与主窗口 transparent:false 行为一致。
        let mut builder =
            WebviewWindowBuilder::new(self.app, "mini", WebviewUrl::App("index.html#/mini".into()))
                .title("Mini Player")
                .inner_size(360.0, 170.0)
                .decorations(false)
                .resizable(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .visible(true);

        #[cfg(target_os = "macos")]
        {
            builder = builder
                .transparent(true)
                .shadow(false)
                .effects(
                    tauri::window::EffectsBuilder::new()
                        .effect(tauri::window::Effect::Popover)
                        .state(tauri::window::EffectState::Active)
                        .build(),
                );
        }

        #[cfg(not(target_os = "macos"))]
        {
            builder = builder.transparent(false);
        }

        let window = builder.build().map_err(|e| e.to_string())?;

        // 恢复上次关闭时的位置；存取都用物理坐标，避开 scale factor 换算误差
        if let Some(pos) = saved_pos {
            let _ = window.set_position(pos);
        }

        // 拖动后实时持久化位置，下次打开恢复
        if let Some(path) = self.mini_position_path() {
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::Moved(pos) = event {
                    let _ = std::fs::write(&path, format!("{{\"x\":{},\"y\":{}}}", pos.x, pos.y));
                }
            });
        }

        let _ = window.set_focus();

        #[cfg(target_os = "macos")]
        {
            let _ = window.set_always_on_top(true);
        }

        Ok(())
    }
}

#[cfg(target_os = "macos")]
pub fn setup_macos_menu(app: &AppHandle) {
    use tauri::menu::{MenuBuilder, PredefinedMenuItem};

    let mk = |r: tauri::Result<_>| r.unwrap_or_else(|e| panic!("menu item: {}", e));

    let about = mk(PredefinedMenuItem::about(app, Some("AudioDock"), None));
    let separator1 = mk(PredefinedMenuItem::separator(app));
    let services = mk(PredefinedMenuItem::services(app, None));
    let separator2 = mk(PredefinedMenuItem::separator(app));
    let hide = mk(PredefinedMenuItem::hide(app, None));
    let hide_others = mk(PredefinedMenuItem::hide_others(app, None));
    let show_all = mk(PredefinedMenuItem::show_all(app, None));
    let separator3 = mk(PredefinedMenuItem::separator(app));
    let quit = mk(PredefinedMenuItem::quit(app, None));

    let menu = MenuBuilder::new(app)
        .items(&[
            &about,
            &separator1,
            &services,
            &separator2,
            &hide,
            &hide_others,
            &show_all,
            &separator3,
            &quit,
        ])
        .build()
        .unwrap();

    app.set_menu(menu).unwrap();
}
