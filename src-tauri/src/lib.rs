//! Voltage shell.
//!
//! The whole job of this crate: open a transparent window, ask the OS
//! compositor to paint the desktop behind it, and point a webview at
//! index.html. Everything visible is HTML — nothing is drawn from Rust.

use tauri::Manager;

#[cfg(target_os = "windows")]
use window_vibrancy::{apply_acrylic, apply_mica};

#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

/// Which native backdrop to attach. Set `VOLTAGE_BACKDROP` to override:
///
///   clear   — no backdrop. The desktop shows through sharp and unblurred.
///   acrylic — blurs whatever is behind the window, tinted to --glass.
///   mica    — Windows 11 theme surface. Nearly opaque in dark mode; it
///             takes only a faint colour cue from the wallpaper.
///
/// Failure is never fatal: a window with no backdrop is still transparent,
/// and the page's panels still read. The outcome goes to stderr, because a
/// silently-failed backdrop and a working one look identical from Rust.
fn choice() -> String {
    std::env::var("VOLTAGE_BACKDROP")
        .unwrap_or_else(|_| "clear".into())
        .to_lowercase()
}

#[cfg(target_os = "windows")]
fn apply_backdrop(window: &tauri::WebviewWindow) {
    match choice().as_str() {
        "clear" => eprintln!("[voltage] backdrop: clear — desktop shows through unblurred"),
        "mica" => match apply_mica(window, Some(true)) {
            Ok(()) => eprintln!("[voltage] backdrop: mica"),
            Err(e) => eprintln!("[voltage] backdrop: FAILED (mica: {e})"),
        },
        // Alpha 120/255: enough tint to keep text legible over a bright
        // desktop, transparent enough that you can still read the desktop.
        _ => match apply_acrylic(window, Some((10, 12, 18, 120))) {
            Ok(()) => eprintln!("[voltage] backdrop: acrylic"),
            Err(e) => eprintln!("[voltage] backdrop: FAILED (acrylic: {e})"),
        },
    }
}

#[cfg(target_os = "macos")]
fn apply_backdrop(window: &tauri::WebviewWindow) {
    if choice() == "clear" {
        eprintln!("[voltage] backdrop: clear — desktop shows through unblurred");
        return;
    }
    match apply_vibrancy(
        window,
        NSVisualEffectMaterial::HudWindow,
        Some(NSVisualEffectState::Active),
        None,
    ) {
        Ok(()) => eprintln!("[voltage] backdrop: vibrancy"),
        Err(e) => eprintln!("[voltage] backdrop: FAILED ({e})"),
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn apply_backdrop(_window: &tauri::WebviewWindow) {
    eprintln!("[voltage] backdrop: unsupported platform");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("tauri.conf.json defines a window labelled `main`");

            // Transparency has to be on before any backdrop can show through.
            let transparent = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .is_some_and(|w| w.transparent);
            eprintln!("[voltage] window transparent: {transparent}");

            apply_backdrop(&window);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start Voltage");
}
