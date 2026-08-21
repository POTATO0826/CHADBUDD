//! ChadBuddy shell.
//!
//! One transparent, undecorated, always-on-top window covering the work area.
//! Everything visible is HTML — nothing is drawn from Rust.
//!
//! The whole reason this crate has any logic in it is click-through. A window
//! that covers the screen would swallow every click meant for the desktop, so
//! the window ignores the cursor by default. But a window that ignores the
//! cursor can't be told when the cursor is over it either — the hover that
//! expands the island would never arrive. So the page reports the rectangle the
//! island currently occupies, and a polling thread here compares the OS cursor
//! position against it and flips `set_ignore_cursor_events` at the boundary.
//!
//! Deliberately no native backdrop (no Mica, no acrylic): on a window this size
//! it would blur the entire desktop rather than just the area behind the island.
//! The desktop shows through sharp, and the island's own translucent fill is
//! what separates it from whatever is behind.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Manager};

/// The interactive region, in CSS pixels relative to the top-left of the page.
#[derive(Clone, Copy, Debug, Default)]
struct HotRect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

impl HotRect {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x <= self.x + self.w && y >= self.y && y <= self.y + self.h
    }
}

struct Hot(Arc<Mutex<HotRect>>);

/// Called by the page whenever the island changes size or state.
#[tauri::command]
fn set_hot_rect(x: f64, y: f64, w: f64, h: f64, hot: tauri::State<'_, Hot>) {
    if let Ok(mut r) = hot.0.lock() {
        *r = HotRect { x, y, w, h };
    }
}

/// The window has no titlebar and is skipped in the taskbar, so the page needs
/// a way out.
#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

/// Hide the island from screen capture, or stop hiding it.
///
/// On Windows this is `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`, on
/// macOS `NSWindow.sharingType = .none`. The compositor leaves the window out
/// of the captured frame entirely, so Zoom, Teams, Discord, OBS, PrintScreen
/// and the Snipping Tool all see the desktop behind it while the advisor still
/// sees the island normally. Client names on a shared screen are exactly the
/// kind of thing this product should not leak.
///
/// Two limits worth knowing, neither of which this function can report:
///
///  * It needs Windows 10 2004 (build 19041) or newer. On older builds the
///    flag is rejected and tao discards the error, so the call succeeds and
///    protects nothing — which is why `protected` is echoed back rather than
///    assumed, and why the UI calls this a request, not a guarantee.
///  * It is a compositor feature. A phone pointed at the monitor, or a capture
///    card downstream of the display output, still sees everything.
///
/// Returns the state actually applied so the page can reflect reality instead
/// of its own optimism.
#[tauri::command]
fn set_content_protected(protected: bool, app: AppHandle) -> Result<bool, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "no window labelled `main`".to_string())?;

    window
        .set_content_protected(protected)
        .map_err(|e| e.to_string())?;

    Ok(protected)
}

/// How often to check where the cursor is. 60ms is under one frame of hover
/// latency at 16ms/frame — imperceptible when entering the island, and cheap.
const POLL: Duration = Duration::from_millis(60);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shared: Arc<Mutex<HotRect>> = Arc::new(Mutex::new(HotRect::default()));

    tauri::Builder::default()
        .manage(Hot(shared.clone()))
        .invoke_handler(tauri::generate_handler![
            set_hot_rect,
            quit,
            set_content_protected
        ])
        .setup(move |app| {
            let window = app
                .get_webview_window("main")
                .expect("tauri.conf.json defines a window labelled `main`");

            // Start fully click-through: until the page reports a rectangle,
            // nothing on screen should be captured by this window.
            let _ = window.set_ignore_cursor_events(true);

            let rect = shared.clone();
            std::thread::spawn(move || {
                let mut ignoring = true;
                loop {
                    std::thread::sleep(POLL);

                    let Ok(cursor) = window.cursor_position() else { continue };
                    let Ok(origin) = window.inner_position() else { continue };
                    let Ok(scale) = window.scale_factor() else { continue };

                    // Cursor is in physical screen pixels; the page reported CSS
                    // pixels relative to its own top-left corner.
                    let x = (cursor.x - f64::from(origin.x)) / scale;
                    let y = (cursor.y - f64::from(origin.y)) / scale;

                    let inside = rect.lock().map(|r| r.contains(x, y)).unwrap_or(false);

                    // `inside == ignoring` is exactly the two cases that need a
                    // flip: over the island while ignoring, or off it while not.
                    if inside == ignoring {
                        if window.set_ignore_cursor_events(!inside).is_ok() {
                            ignoring = !inside;
                        }
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start ChadBuddy");
}
