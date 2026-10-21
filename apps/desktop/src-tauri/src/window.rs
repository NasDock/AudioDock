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
        if let Some(existing) = self.app.get_webview_window("mini") {
            let _ = existing.close();
        }

        // window 仅在 macOS 分支使用（set_always_on_top），其它平台告警关闭
        #[cfg_attr(not(target_os = "macos"), allow(unused_variables))]
        let window =
            WebviewWindowBuilder::new(self.app, "mini", WebviewUrl::App("index.html#/mini".into()))
                .title("Mini Player")
                .inner_size(360.0, 170.0)
                .decorations(false)
                .resizable(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .visible(true)
                .build()
                .map_err(|e| e.to_string())?;

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
