//! Windows 任务栏缩略图定制（仅 Windows）。
//!
//! 鼠标悬停任务栏图标时，默认显示的是窗口实时缩略图（"桌面缩略图"）。
//! 这里把它替换成「当前歌曲封面」，并在缩略图下方挂上「上一首 / 播放暂停 / 下一首」
//! 工具条按钮（Windows Media Player 的经典形态）：
//!
//! 1. **缩略图按钮** — `ITaskbarList3::ThumbBarAddButtons`（每窗口最多 7 个，不可移除，
//!    因此只在 setup 时加一次；播放/暂停图标和 tooltip 用 `ThumbBarUpdateButtons` 热更新）。
//! 2. **封面缩略图** — `DWMWA_FORCE_ICONIC_REPRESENTATION` 关掉实时预览，改由
//!    `WM_DWMSENDICONICTHUMBNAIL` 回调里 `DwmSetIconicThumbnail` 提供静态位图；
//!    Aero Peek 走 `WM_DWMSENDICONICLIVEPREVIEWBITMAP` + `DwmSetIconicLivePreviewBitmap`。
//!
//! 线程模型：所有 Win32/COM 操作都收敛到窗口线程（subclass 过程）执行。
//! 其它线程（命令/下载）只改共享状态，再 `SendMessageW(WM_APP_TASKBAR_REFRESH)`
//! 让窗口线程刷新。封面下载在异步任务里做，完成后 `DwmInvalidateIconicBitmaps`
//! 让 DWM 重新来要图。

use std::mem::size_of;
use std::ptr::{copy_nonoverlapping, null_mut};
use std::sync::{Mutex, OnceLock};

use image::RgbaImage;
use tauri::{AppHandle, Manager, WebviewWindow};

use windows::core::{BOOL, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Dwm::{
    DwmInvalidateIconicBitmaps, DwmSetIconicLivePreviewBitmap, DwmSetIconicThumbnail,
    DwmSetWindowAttribute, DWMWA_FORCE_ICONIC_REPRESENTATION, DWMWA_HAS_ICONIC_BITMAP,
};
use windows::Win32::Graphics::Gdi::{
    CreateBitmap, CreateDIBSection, DeleteObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
    DIB_RGB_COLORS, HBITMAP,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::{
    DefSubclassProc, ITaskbarList3, RemoveWindowSubclass, SetWindowSubclass, TaskbarList,
    THBF_ENABLED, THB_FLAGS, THB_ICON, THB_TOOLTIP, THUMBBUTTON,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateIconIndirect, DestroyIcon, GetClientRect, SendMessageW, HICON, ICONINFO, WM_COMMAND,
    WM_DESTROY, WM_SETTINGCHANGE,
};

use crate::tray;

// ============================================================================
// 常量
// ============================================================================

/// 缩略图按钮 id（点击后以 `WM_COMMAND` 的 LOWORD 回来）。
const BTN_PREV: u32 = 101;
const BTN_PLAY_PAUSE: u32 = 102;
const BTN_NEXT: u32 = 103;

/// `WM_APP` 基址上的私有消息：外部线程请求窗口线程刷新按钮/缩略图。
const WM_APP_TASKBAR_REFRESH: u32 = 0x8000 + 50;

/// DWM iconic thumbnail 请求（winuser.h 里未导出到所有 SDK 头，这里固定值）。
const WM_DWMSENDICONICTHUMBNAIL: u32 = 0x0323;
const WM_DWMSENDICONICLIVEPREVIEWBITMAP: u32 = 0x0326;

/// subclass id（本进程内唯一即可）。
const SUBCLASS_ID: usize = 0x7462_0001;

/// 缩略图按钮点击通知码（winuser/commctrl 的 THBN_CLICKED）。
const THBN_CLICKED: u32 = 0x1800;

/// 封面解码后的最大边长（缩略图请求一般 ≤ 400px，留一倍余量）。
const COVER_MAX_SIDE: u32 = 512;

/// 缩略图背景色（封面按比例居中后两侧留黑边）。
const BG: [u8; 4] = [18, 18, 18, 255];

// ============================================================================
// 共享状态
// ============================================================================

struct Icons {
    prev: HICON,
    play: HICON,
    pause: HICON,
    next: HICON,
}

struct TaskbarState {
    hwnd: HWND,
    /// 当前封面（解码后的 RGBA，最大边 ≤ COVER_MAX_SIDE）。
    cover: Option<RgbaImage>,
    /// 封面 URL 去重 + 加载代数（防快速切歌时旧图覆盖新图）。
    cover_url: Option<String>,
    cover_gen: u64,
    /// 无封面时的兜底图（app logo）。
    fallback: RgbaImage,
    is_playing: bool,
    light_theme: bool,
    icons: Option<Icons>,
    taskbar: Option<ITaskbarList3>,
    /// DWM 是否请求过缩略图（没有请求过就不必 invalidate）。
    thumb_requested: bool,
}

// HWND/HICON 是裸指针句柄、ITaskbarList3 是 COM 接口，windows-rs 均未实现 Send，
// 而全局 static Mutex<TaskbarState> 要求 Send。文件头「线程模型」已约定：
// 所有 Win32/COM 调用都收敛到窗口线程（subclass 过程 / setup）执行；
// 其它线程只在锁内读写普通数据字段，再 SendMessageW 通知窗口线程刷新，
// 不会跨线程触碰这些句柄/接口本身，故此处声明 Send 是安全的。
unsafe impl Send for TaskbarState {}

fn state() -> &'static Mutex<TaskbarState> {
    static STATE: OnceLock<Mutex<TaskbarState>> = OnceLock::new();
    STATE.get_or_init(|| {
        let fallback = decode_embedded_png(include_bytes!("../../public/logo.png"))
            .map(|img| downscale(img, COVER_MAX_SIDE))
            .unwrap_or_else(|| RgbaImage::new(1, 1));
        Mutex::new(TaskbarState {
            hwnd: HWND(null_mut()),
            cover: None,
            cover_url: None,
            cover_gen: 0,
            fallback,
            is_playing: false,
            light_theme: true,
            icons: None,
            taskbar: None,
            thumb_requested: false,
        })
    })
}

/// 全局 AppHandle（emit 播控事件用）。
fn app_handle_lock() -> &'static Mutex<Option<AppHandle>> {
    static APP: OnceLock<Mutex<Option<AppHandle>>> = OnceLock::new();
    APP.get_or_init(|| Mutex::new(None))
}

// ============================================================================
// 对外入口
// ============================================================================

/// 在主窗口 setup 时调用：挂 subclass、加缩略图按钮、开启 iconic thumbnail。
pub fn init(window: &WebviewWindow) {
    let hwnd = match window.hwnd() {
        Ok(h) => h,
        Err(e) => {
            eprintln!("[TaskbarThumb] hwnd unavailable: {e}");
            return;
        }
    };
    *app_handle_lock().lock().unwrap() = Some(window.app_handle().clone());

    // 主线程一般已被 WebView2 初始化过 COM；这里幂等再保证一次。
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    }

    let light_theme = system_uses_light_theme();
    {
        let mut st = state().lock().unwrap();
        st.hwnd = hwnd;
        st.light_theme = light_theme;
        st.icons = Some(build_icons(light_theme));
        st.taskbar = create_taskbar_list();
    }

    unsafe {
        // 挂 subclass：接管 WM_COMMAND（按钮点击）与 DWM 缩略图回调。
        let _ = SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0);

        // 关掉实时窗口预览，改用我们提供的静态封面缩略图。
        let enable = BOOL(1);
        let r1 = DwmSetWindowAttribute(
            hwnd,
            DWMWA_FORCE_ICONIC_REPRESENTATION,
            &enable as *const BOOL as *const _,
            size_of::<BOOL>() as u32,
        );
        // 关键：必须同时声明 HAS_ICONIC_BITMAP，否则 DWM 不会向窗口发送
        // WM_DWMSENDICONICTHUMBNAIL / WM_DWMSENDICONICLIVEPREVIEWBITMAP，
        // 悬停缩略图会一直停留在「灰白底板 + 居中图标」的系统占位形态。
        let r2 = DwmSetWindowAttribute(
            hwnd,
            DWMWA_HAS_ICONIC_BITMAP,
            &enable as *const BOOL as *const _,
            size_of::<BOOL>() as u32,
        );
        if let Err(e) = r1 {
            eprintln!("[TaskbarThumb] FORCE_ICONIC_REPRESENTATION failed: {e}");
        }
        if let Err(e) = r2 {
            eprintln!("[TaskbarThumb] HAS_ICONIC_BITMAP failed: {e}");
        }
    }

    // 窗口线程上直接加按钮（ThumbBarAddButtons 只能加一次，之后只能 Update）。
    add_thumb_buttons();
}

/// 播放状态/封面变化时由 tray::update_player_state 调用（任意线程）。
pub fn sync(app: &AppHandle, is_playing: bool, cover: Option<String>) {
    *app_handle_lock().lock().unwrap() = Some(app.clone());
    let cover_url = cover.filter(|c| !c.is_empty());
    let mut need_refresh = false;
    let mut need_load: Option<String> = None;

    {
        let mut st = state().lock().unwrap();
        if st.is_playing != is_playing {
            st.is_playing = is_playing;
            need_refresh = true;
        }
        if st.cover_url != cover_url {
            st.cover_url = cover_url.clone();
            st.cover_gen += 1;
            match &cover_url {
                Some(url) => {
                    // 不清掉旧封面：加载期间继续显示上一张，成功后原子替换。
                    need_load = Some(url.clone());
                }
                None => {
                    st.cover = None;
                    need_refresh = true;
                }
            }
        }
    }

    if let Some(url) = need_load {
        spawn_cover_loader(app, url);
    }
    if need_refresh {
        request_refresh();
    }
}

/// 任意线程 → 通知窗口线程刷新按钮与缩略图。
fn request_refresh() {
    let hwnd = { state().lock().unwrap().hwnd };
    if hwnd.0.is_null() {
        return;
    }
    unsafe {
        SendMessageW(hwnd, WM_APP_TASKBAR_REFRESH, Some(WPARAM(0)), Some(LPARAM(0)));
    }
}

fn emit_player_event(event: &str) {
    if let Some(app) = app_handle_lock().lock().unwrap().clone() {
        tray::emit_event(&app, event);
    }
}

// ============================================================================
// 窗口线程：subclass 过程
// ============================================================================

unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _uidata: usize,
    _dwrefdata: usize,
) -> LRESULT {
    match msg {
        WM_APP_TASKBAR_REFRESH => {
            update_thumb_buttons();
            invalidate_thumbs();
            LRESULT(0)
        }
        WM_COMMAND => {
            // 缩略图按钮点击：LOWORD(wParam)==按钮 id，HIWORD==THBN_CLICKED(0x1800)。
            // 个别实现 HIWORD 传 0，这里两者都收（按钮 id 空间与菜单命令不冲突）。
            let id = (wparam.0 & 0xffff) as u32;
            let hi = ((wparam.0 >> 16) & 0xffff) as u32;
            if hi == THBN_CLICKED || hi == 0 {
                match id {
                    BTN_PREV => emit_player_event("player:prev"),
                    BTN_PLAY_PAUSE => emit_player_event("player:toggle"),
                    BTN_NEXT => emit_player_event("player:next"),
                    _ => {}
                }
            }
            LRESULT(0)
        }
        WM_DWMSENDICONICTHUMBNAIL => {
            // HIWORD(lParam)=宽, LOWORD(lParam)=高（请求的上限尺寸）。
            let w = ((lparam.0 >> 16) & 0xffff).max(1) as u32;
            let h = (lparam.0 & 0xffff).max(1) as u32;
            if let Some(hbmp) = render_cover_bitmap(w, h) {
                let _ = DwmSetIconicThumbnail(hwnd, hbmp, 0);
                // DWM 已拷贝位图内容，释放句柄防止泄漏。
                let _ = DeleteObject(hbmp.into());
            }
            mark_thumb_requested();
            LRESULT(0)
        }
        WM_DWMSENDICONICLIVEPREVIEWBITMAP => {
            // Aero Peek 的"实况预览"位图，同样给封面，避免出现黑块。
            let mut rect = windows::Win32::Foundation::RECT::default();
            let _ = GetClientRect(hwnd, &mut rect);
            let w = (rect.right - rect.left).max(1) as u32;
            let h = (rect.bottom - rect.top).max(1) as u32;
            if let Some(hbmp) = render_cover_bitmap(w, h) {
                let _ = DwmSetIconicLivePreviewBitmap(hwnd, hbmp, None, 0);
                let _ = DeleteObject(hbmp.into());
            }
            mark_thumb_requested();
            LRESULT(0)
        }
        WM_SETTINGCHANGE => {
            // 系统深浅色切换 → 重绘按钮图标颜色。
            let light = system_uses_light_theme();
            let changed = {
                let mut st = state().lock().unwrap();
                if st.light_theme != light {
                    st.light_theme = light;
                    if let Some(old) = st.icons.take() {
                        destroy_icons(&old);
                    }
                    st.icons = Some(build_icons(light));
                    true
                } else {
                    false
                }
            };
            if changed {
                update_thumb_buttons();
            }
            DefSubclassProc(hwnd, msg, wparam, lparam)
        }
        WM_DESTROY => {
            let _ = RemoveWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID);
            {
                let mut st = state().lock().unwrap();
                if let Some(icons) = st.icons.take() {
                    destroy_icons(&icons);
                }
                st.taskbar = None;
            }
            DefSubclassProc(hwnd, msg, wparam, lparam)
        }
        _ => DefSubclassProc(hwnd, msg, wparam, lparam),
    }
}

fn mark_thumb_requested() {
    state().lock().unwrap().thumb_requested = true;
}

fn invalidate_thumbs() {
    let st = state().lock().unwrap();
    if st.thumb_requested && !st.hwnd.0.is_null() {
        let _ = unsafe { DwmInvalidateIconicBitmaps(st.hwnd) };
    }
}

// ============================================================================
// 缩略图按钮
// ============================================================================

fn create_taskbar_list() -> Option<ITaskbarList3> {
    unsafe {
        let tb: ITaskbarList3 = match CoCreateInstance(
            &TaskbarList,
            None::<&windows::core::IUnknown>,
            CLSCTX_INPROC_SERVER,
        ) {
            Ok(t) => t,
            Err(e) => {
                eprintln!("[TaskbarThumb] CoCreateInstance(TaskbarList) failed: {e}");
                return None;
            }
        };
        if let Err(e) = tb.HrInit() {
            eprintln!("[TaskbarThumb] HrInit failed: {e}");
            return None;
        }
        Some(tb)
    }
}

fn tip(text: &str) -> [u16; 260] {
    let mut buf = [0u16; 260];
    for (i, u) in text.encode_utf16().take(259).enumerate() {
        buf[i] = u;
    }
    buf
}

/// 窗口线程：把 3 个播控按钮加进缩略图（只可调用一次）。
fn add_thumb_buttons() {
    let st = state().lock().unwrap();
    let (Some(icons), Some(tb), hwnd) = (&st.icons, &st.taskbar, st.hwnd) else {
        return;
    };
    let buttons = thumb_buttons(icons, st.is_playing);
    unsafe {
        if let Err(e) = tb.ThumbBarAddButtons(hwnd, &buttons) {
            eprintln!("[TaskbarThumb] ThumbBarAddButtons failed: {e}");
        }
    }
}

/// 窗口线程：播放/暂停图标与 tooltip 热更新。
fn update_thumb_buttons() {
    let st = state().lock().unwrap();
    let (Some(icons), Some(tb), hwnd) = (&st.icons, &st.taskbar, st.hwnd) else {
        return;
    };
    let buttons = thumb_buttons(icons, st.is_playing);
    unsafe {
        if let Err(e) = tb.ThumbBarUpdateButtons(hwnd, &buttons) {
            eprintln!("[TaskbarThumb] ThumbBarUpdateButtons failed: {e}");
        }
    }
}

fn thumb_buttons(icons: &Icons, is_playing: bool) -> [THUMBBUTTON; 3] {
    [
        make_button(BTN_PREV, icons.prev, "上一曲"),
        make_button(
            BTN_PLAY_PAUSE,
            if is_playing { icons.pause } else { icons.play },
            if is_playing { "暂停" } else { "播放" },
        ),
        make_button(BTN_NEXT, icons.next, "下一曲"),
    ]
}

fn make_button(id: u32, icon: HICON, tip_text: &str) -> THUMBBUTTON {
    THUMBBUTTON {
        dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
        iId: id,
        iBitmap: 0,
        hIcon: icon,
        szTip: tip(tip_text),
        dwFlags: THBF_ENABLED,
    }
}

// ============================================================================
// 缩略图位图渲染
// ============================================================================

/// 把封面（或兜底 logo）按比例缩放居中合成到 w×h 的 32bpp BGRA 位图。
fn render_cover_bitmap(w: u32, h: u32) -> Option<HBITMAP> {
    let src = {
        let st = state().lock().unwrap();
        st.cover.as_ref().unwrap_or(&st.fallback).clone()
    };
    let mut out = RgbaImage::from_pixel(w, h, image::Rgba(BG));

    let (sw, sh) = src.dimensions();
    if sw > 0 && sh > 0 {
        let scale = (w as f32 / sw as f32).min(h as f32 / sh as f32);
        let dw = ((sw as f32 * scale).round() as u32).clamp(1, w);
        let dh = ((sh as f32 * scale).round() as u32).clamp(1, h);
        let resized = image::imageops::resize(&src, dw, dh, image::imageops::FilterType::Triangle);
        let x = ((w - dw) / 2) as i64;
        let y = ((h - dh) / 2) as i64;
        image::imageops::replace(&mut out, &resized, x, y);
    }

    // RGBA → BGRA（合成底不透明，alpha 恒 255，预乘即恒等）。
    let mut bgra = out.into_raw();
    for px in bgra.chunks_exact_mut(4) {
        px.swap(0, 2);
    }
    create_dib(w as i32, h as i32, &bgra)
}

/// 建 32bpp top-down DIB 并拷入 BGRA 像素。
fn create_dib(width: i32, height: i32, bgra: &[u8]) -> Option<HBITMAP> {
    let bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height, // top-down
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            biSizeImage: (width * height * 4) as u32,
            ..Default::default()
        },
        ..Default::default()
    };
    unsafe {
        let mut bits: *mut std::ffi::c_void = null_mut();
        let hbmp = match CreateDIBSection(None, &bmi, DIB_RGB_COLORS, &mut bits, None, 0) {
            Ok(b) => b,
            Err(e) => {
                eprintln!("[TaskbarThumb] CreateDIBSection failed: {e}");
                return None;
            }
        };
        if bits.is_null() {
            let _ = DeleteObject(hbmp.into());
            return None;
        }
        copy_nonoverlapping(bgra.as_ptr(), bits as *mut u8, bgra.len());
        Some(hbmp)
    }
}

// ============================================================================
// 图标（缩略图按钮用）
// ============================================================================

fn decode_embedded_png(bytes: &[u8]) -> Option<RgbaImage> {
    image::load_from_memory(bytes).ok().map(|img| img.to_rgba8())
}

/// PNG 字形图标 → 按深浅色染色 → HICON。
/// public/ 下的 play/pause/next/previous.png 是黑色字形（macOS 模板图标），
/// 任务栏深色时染白、浅色时保持黑。
fn build_icons(light_theme: bool) -> Icons {
    let tint: Option<[u8; 3]> = if light_theme {
        None
    } else {
        Some([255, 255, 255])
    };
    Icons {
        prev: icon_from_png(include_bytes!("../../public/previous.png"), tint),
        play: icon_from_png(include_bytes!("../../public/play.png"), tint),
        pause: icon_from_png(include_bytes!("../../public/pause.png"), tint),
        next: icon_from_png(include_bytes!("../../public/next.png"), tint),
    }
}

fn icon_from_png(bytes: &[u8], tint: Option<[u8; 3]>) -> HICON {
    let fallback = HICON(null_mut());
    let Some(mut img) = decode_embedded_png(bytes) else {
        return fallback;
    };
    if let Some(rgb) = tint {
        for px in img.pixels_mut() {
            px.0[0] = rgb[0];
            px.0[1] = rgb[1];
            px.0[2] = rgb[2];
        }
    }

    let (w, h) = img.dimensions();
    let (w, h) = (w as i32, h as i32);

    // RGBA → BGRA 预乘。
    let mut bgra = img.into_raw();
    for px in bgra.chunks_exact_mut(4) {
        let a = px[3] as u32;
        for c in px.iter_mut().take(3) {
            *c = ((*c as u32 * a) / 255) as u8;
        }
        px.swap(0, 2);
    }

    let Some(hbm_color) = create_dib(w, h, &bgra) else {
        return fallback;
    };
    let hbm_mask = unsafe { CreateBitmap(w, h, 1, 1, None) };
    if hbm_mask.is_invalid() {
        unsafe {
            let _ = DeleteObject(hbm_color.into());
        }
        return fallback;
    }

    let info = ICONINFO {
        fIcon: BOOL(1),
        xHotspot: 0,
        yHotspot: 0,
        hbmMask: hbm_mask,
        hbmColor: hbm_color,
    };
    let icon = unsafe { CreateIconIndirect(&info) }.unwrap_or(fallback);
    unsafe {
        let _ = DeleteObject(hbm_color.into());
        let _ = DeleteObject(hbm_mask.into());
    }
    icon
}

fn destroy_icons(icons: &Icons) {
    for icon in [icons.prev, icons.play, icons.pause, icons.next] {
        if !icon.is_invalid() {
            let _ = unsafe { DestroyIcon(icon) };
        }
    }
}

// ============================================================================
// 系统深浅色
// ============================================================================

/// 任务栏颜色跟随 `SystemUsesLightTheme`（不是 `AppsUseLightTheme`）。
fn system_uses_light_theme() -> bool {
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    let subkey = wide(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
    let value_name = wide("SystemUsesLightTheme");
    let mut value: u32 = 1;
    let mut size = size_of::<u32>() as u32;
    let err = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            PCWSTR(subkey.as_ptr()),
            PCWSTR(value_name.as_ptr()),
            RRF_RT_REG_DWORD,
            None,
            Some(&mut value as *mut u32 as *mut _),
            Some(&mut size),
        )
    };
    err.0 == 0 && value != 0
}

// ============================================================================
// 封面加载
// ============================================================================

fn spawn_cover_loader(app: &AppHandle, url: String) {
    let app = app.clone();
    let gen = { state().lock().unwrap().cover_gen };
    tauri::async_runtime::spawn(async move {
        let Some(img) = load_cover_image(&app, &url).await else {
            return;
        };
        let img = downscale(img, COVER_MAX_SIDE);
        {
            let mut st = state().lock().unwrap();
            if st.cover_gen != gen {
                return; // 已经切歌，丢弃旧图
            }
            st.cover = Some(img);
        }
        // DWM 只在悬停时来要图；invalidate 后会重新发 WM_DWMSENDICONICTHUMBNAIL。
        let hwnd = { state().lock().unwrap().hwnd };
        if !hwnd.0.is_null() {
            let _ = unsafe { DwmInvalidateIconicBitmaps(hwnd) };
        }
    });
}

/// 支持 http(s) 与 `media://`（含 Windows 下的 `http://media.localhost/` 形态）。
async fn load_cover_image(app: &AppHandle, url: &str) -> Option<RgbaImage> {
    if let Some(bytes) = read_media_url(app, url) {
        return image::load_from_memory(&bytes).ok().map(|img| img.to_rgba8());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .ok()?;
    let resp = match client.get(url).send().await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[TaskbarThumb] cover fetch failed: {url} err={e}");
            return None;
        }
    };
    if !resp.status().is_success() {
        eprintln!("[TaskbarThumb] cover fetch status {}: {url}", resp.status());
        return None;
    }
    let bytes = resp.bytes().await.ok()?;
    match image::load_from_memory(&bytes) {
        Ok(img) => Some(img.to_rgba8()),
        Err(_) => {
            eprintln!("[TaskbarThumb] cover decode failed: {url}");
            None
        }
    }
}

/// `media://cover/<file>` / `http://media.localhost/cover/<file>` → 本地文件读取。
/// 与 protocol.rs 的路径解析规则保持一致。
fn read_media_url(app: &AppHandle, url: &str) -> Option<Vec<u8>> {
    let rest = if let Some(r) = url.strip_prefix("media://") {
        r.to_string()
    } else if let Some(r) = url
        .strip_prefix("http://media.localhost/")
        .or_else(|| url.strip_prefix("https://media.localhost/"))
    {
        r.to_string()
    } else {
        return None;
    };

    use crate::commands::AppState;
    let state = app.state::<AppState>();
    let cache_dir = state.cache_manager.cache_dir().to_path_buf();
    let download_path = state
        .download_path
        .lock()
        .map(|s| s.clone())
        .unwrap_or_default();

    let (kind, rel) = match rest.split_once('/') {
        Some((k, r)) => (k.to_string(), r.to_string()),
        None => (rest.clone(), String::new()),
    };
    let decoded = percent_encoding::percent_decode_str(&rel)
        .decode_utf8_lossy()
        .to_string();
    let path = match kind.as_str() {
        "cover" | "metadata" => cache_dir.join(decoded),
        "audio" => {
            let base = crate::cache::expand_tilde(&download_path)
                .unwrap_or_else(|_| download_path.clone());
            std::path::PathBuf::from(base).join(decoded)
        }
        other => cache_dir.join(other),
    };
    std::fs::read(path).ok()
}

fn downscale(img: RgbaImage, max_side: u32) -> RgbaImage {
    let (w, h) = img.dimensions();
    let longest = w.max(h);
    if longest <= max_side {
        return img;
    }
    let scale = max_side as f32 / longest as f32;
    let nw = ((w as f32 * scale).round() as u32).max(1);
    let nh = ((h as f32 * scale).round() as u32).max(1);
    image::imageops::resize(&img, nw, nh, image::imageops::FilterType::Triangle)
}
