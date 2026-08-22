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
use std::time::{Duration, Instant};

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
    /// Whether the cursor is inside, with the edges pushed out by `slack`.
    fn contains_within(&self, x: f64, y: f64, slack: f64) -> bool {
        x >= self.x - slack
            && x <= self.x + self.w + slack
            && y >= self.y - slack
            && y <= self.y + self.h + slack
    }
}

/// The live rectangle, plus when the page last vouched for it.
struct Hot(Arc<Mutex<(HotRect, Instant)>>);

/// Called by the page whenever the island changes size or state.
#[tauri::command]
fn set_hot_rect(x: f64, y: f64, w: f64, h: f64, hot: tauri::State<'_, Hot>) {
    if let Ok(mut r) = hot.0.lock() {
        *r = (HotRect { x, y, w, h }, Instant::now());
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

/// Take keyboard focus.
///
/// The window is created with `focus: false` so the island never steals the
/// caret from whatever the advisor is typing in. That is right for a pill
/// sitting quietly at the top of the screen and wrong the moment it becomes a
/// full dashboard: Escape has to close it, and a window without focus never
/// receives the keystroke — it goes to the editor behind instead.
///
/// So focus is taken on open and never on idle, alert or peek.
/// Telegram, inside a ChadBuddy window.
///
/// A real MTProto voice stack in this app would be a native project; Telegram
/// Web already carries calls over WebRTC, so the honest in-app answer is a
/// second webview window pointed at web.telegram.org with the client's chat
/// open. First use asks for a QR link-device scan — after that, one click
/// lands on the chat with the call button a tap away, and the bridge logs the
/// call either way because the service message rides the socket regardless of
/// where the call ran.
///
/// A normal decorated window on purpose: it must inherit none of the
/// overlay's transparency or click-through machinery. The peer is digits-only
/// by validation, so the URL cannot be steered anywhere but a Telegram chat.
/// The window gets no IPC capabilities — a remote page has no business
/// invoking anything.
#[tauri::command]
fn open_telegram(app: AppHandle, peer: String) -> Result<(), String> {
    if peer.is_empty() || !peer.chars().all(|c| c.is_ascii_digit()) {
        return Err(format!("not a telegram peer id: {peer}"));
    }

    println!("[tgweb] open requested for peer {peer}");

    /* The window already exists — created once in setup(), because runtime
       webview creation on this app silently never navigated however it was
       threaded. Opening is now: point the SPA at the peer, show, focus. */
    let w = app
        .get_webview_window("tgweb")
        .ok_or_else(|| "telegram window was not created at startup".to_string())?;
    let _ = w.eval(&format!("location.hash = '#{peer}'"));
    let _ = w.show();
    let _ = w.unminimize();
    let _ = w.set_focus();
    Ok(())
}

/// Hand a URL to the operating system — the Telegram deep link, mailto.
///
/// The scheme allowlist is the entire security model, and it is enough:
/// everything after the scheme is data to the registered protocol handler,
/// never a command line. An http url would also "work" here, which is exactly
/// why it is not on the list — the page has no business opening browsers.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let allowed = url.starts_with("tg://") || url.starts_with("mailto:");
    if !allowed {
        return Err(format!("refusing to open non-allowlisted url: {url}"));
    }
    // `start` needs the empty-title argument or it eats the url as a title.
    std::process::Command::new("cmd")
        .args(["/C", "start", "", &url])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn focus_window(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "no window labelled `main`".to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

/// How long a rectangle stays trusted without the page renewing it.
///
/// The page re-sends every two seconds. If three of those go missing the page
/// has crashed, reloaded, or wedged — and whatever it last claimed is still
/// being enforced. On a transparent, always-on-top, full-screen window that
/// means every click on the machine disappearing into a window the user cannot
/// see and cannot dismiss. Treating silence as a fault and letting the cursor
/// through costs a moment of hover responsiveness and buys back the desktop.
const STALE_AFTER: Duration = Duration::from_secs(6);

/// Deadband on the capture boundary, in CSS pixels.
///
/// Entering is decided on the true edge; leaving needs this much further. That
/// asymmetry is the whole point. Without it a cursor resting on the boundary
/// crosses it on its own — hand tremor is larger than the 60ms sample grid —
/// and every crossing restyles the window between capturing and transparent,
/// which the compositor shows as a flicker. It is worst along the bottom edge,
/// where the window stops and the taskbar begins, because that is a boundary
/// people deliberately move the pointer across.
const EDGE_SLACK: f64 = 8.0;

/// How often to check where the cursor is. 60ms is under one frame of hover
/// latency at 16ms/frame — imperceptible when entering the island, and cheap.
const POLL: Duration = Duration::from_millis(60);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shared: Arc<Mutex<(HotRect, Instant)>> =
        Arc::new(Mutex::new((HotRect::default(), Instant::now())));

    tauri::Builder::default()
        .manage(Hot(shared.clone()))
        .invoke_handler(tauri::generate_handler![
            set_hot_rect,
            quit,
            set_content_protected,
            focus_window,
            open_external,
            open_telegram
        ])
        .setup(move |app| {
            /* The Telegram window, created once here and only ever shown.
               Runtime creation was tried three ways — worker thread, then
               run_on_main_thread — and the trace showed the closure never
               executing and the webview never navigating: a white shell,
               no error. setup() runs on the main thread before the event
               loop starts, which is the one place window creation is
               documented to work everywhere. Hidden until the Call button
               wants it; closing it hides it again rather than destroying
               the only copy. */
            {
                let tg_url: tauri::Url = "https://web.telegram.org/a/"
                    .parse()
                    .expect("static url parses");
                match tauri::WebviewWindowBuilder::new(
                    app,
                    "tgweb",
                    tauri::WebviewUrl::External(tg_url),
                )
                .title("Telegram · ChadBuddy")
                .inner_size(440.0, 720.0)
                .visible(false)
                .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
                .on_navigation(|url| {
                    println!("[tgweb] navigating: {url}");
                    true
                })
                .on_page_load(|_w, payload| {
                    println!("[tgweb] page {:?}: {}", payload.event(), payload.url());
                })
                .build()
                {
                    Ok(tg) => {
                        println!("[tgweb] window built at startup");
                        let tg2 = tg.clone();
                        tg.on_window_event(move |event| {
                            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                                api.prevent_close();
                                let _ = tg2.hide();
                            }
                        });
                    }
                    Err(e) => eprintln!("[tgweb] startup build failed: {e}"),
                }
            }

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
                    let Ok(size) = window.inner_size() else { continue };

                    // Cursor is in physical screen pixels; the page reported CSS
                    // pixels relative to its own top-left corner.
                    let x = (cursor.x - f64::from(origin.x)) / scale;
                    let y = (cursor.y - f64::from(origin.y)) / scale;

                    /* Once the cursor has left the window entirely, leave the
                       style alone.

                       This window covers the work area, which stops short of the
                       taskbar — so the taskbar is genuinely outside it, and
                       moving down to the app icons crosses a real window edge
                       rather than the island's. The old loop treated that as
                       'not over the island' and flipped the window transparent,
                       which restyles it, which the compositor shows as a flash.
                       Do it on the way out and again on the way back and the
                       island appears to stutter every time someone reaches for
                       their taskbar.

                       The flip is pointless there anyway: click-through decides
                       what happens to clicks landing *on this window*, and none
                       are. Whatever state it was left in is already correct, so
                       the loop simply waits for the cursor to come back. */
                    let w = f64::from(size.width) / scale;
                    let h = f64::from(size.height) / scale;
                    if x < 0.0 || y < 0.0 || x > w || y > h {
                        continue;
                    }

                    // A rectangle the page has stopped renewing is not trusted:
                    // `inside` goes false, the window ignores the cursor, and the
                    // desktop keeps working whatever went wrong upstairs.
                    // Sticky once captured: leaving costs EDGE_SLACK more travel
                    // than entering did.
                    let slack = if ignoring { 0.0 } else { EDGE_SLACK };
                    let inside = rect
                        .lock()
                        .map(|guard| {
                            let (r, at) = *guard;
                            at.elapsed() < STALE_AFTER && r.contains_within(x, y, slack)
                        })
                        .unwrap_or(false);

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
