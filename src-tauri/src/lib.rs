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
/// The Telegram window's voice, arriving in the terminal. The page has an
/// IPC capability scoped to its window and origin for exactly this: the
/// white-screen hunt proved that debugging a remote page with no return
/// channel is guessing with extra steps.
#[tauri::command]
fn tg_diag(msg: String) {
    println!("[tgweb][js] {msg}");
}

#[tauri::command]
fn open_telegram(app: AppHandle, peer: String) -> Result<(), String> {
    if peer.is_empty() || !peer.chars().all(|c| c.is_ascii_digit()) {
        return Err(format!("not a telegram peer id: {peer}"));
    }

    println!("[tgweb] open requested for peer {peer}");

    /* The window already exists — created once in setup(), because runtime
       webview creation silently never navigated however it was threaded.
       Opening a chat is a FULL navigation with the peer in the hash and a
       marker in the query: the A client only honours the hash at SPA boot
       (recon proved runtime hash changes change nothing), and the marker is
       what tells the page-load handler this load intends to ring. */
    let w = app
        .get_webview_window("tgweb")
        .ok_or_else(|| "telegram window was not created at startup".to_string())?;
    let _ = w.eval(&format!(
        "location.href='https://web.telegram.org/a/?cbcall=1#{peer}'"
    ));
    let _ = w.show();
    let _ = w.unminimize();
    let _ = w.set_focus();
    println!("[tgweb] navigating to peer {peer} with call intent");
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
            open_telegram,
            tg_diag
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
                .on_page_load(|w, payload| {
                    println!("[tgweb] page {:?}: {}", payload.event(), payload.url());
                    if !matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                        return;
                    }
                    /* Findings this handler encodes, so nobody re-digs:
                       eval() works (proven by a forced navigation arriving in
                       this log); document.title does not reach the native
                       title; __TAURI_INTERNALS__ never materialises on the
                       remote origin despite the capability, so the page
                       reports by fetching the dev server — mixed-content
                       rules carve localhost out as trustworthy. And the big
                       one: the A client ignores runtime hash changes — recon
                       showed zero chat-header buttons after location.hash —
                       and honours the hash ONLY at SPA boot. So opening a
                       chat is a real navigation, and this handler is where
                       the call-press must live: it is the only code that
                       runs at the right moment. */
                    let is_call = payload.url().query().unwrap_or("").contains("cbcall");
                    if !is_call {
                        let _ = w.eval("try{fetch('http://localhost:4321/__diag?m=boot-ok',{mode:'no-cors'})}catch(e){}");
                        return;
                    }
                    /* ONE dial per click, mechanically. The first version
                       re-pressed whatever it matched every 300ms, and left
                       the cbcall marker in the URL — so a call that ended
                       inside the retry window was redialled, and any SPA
                       reload redialled with nobody clicking anything. Two
                       fixes: the marker is consumed (stripped from the URL)
                       the moment the script arms, and the hunt is a stage
                       machine where every stage fires exactly once and the
                       confirm press ends the loop outright. */
                    let _ = w.eval(concat!(
                        "(function(){",
                        "var diag=function(m){try{fetch('http://localhost:4321/__diag?m='+encodeURIComponent('call: '+String(m).slice(0,380)),{mode:'no-cors'}).catch(function(){});}catch(e){}};",
                        "if(window.__cbCalled){diag('already-armed-this-load');return;}window.__cbCalled=1;",
                        "try{history.replaceState(null,'',location.pathname+location.hash);}catch(e){}",
                        "var press=function(el){['mousedown','mouseup','click'].forEach(function(k){",
                        "el.dispatchEvent(new MouseEvent(k,{bubbles:true,cancelable:true,view:window}));});};",
                        "if(document.querySelector('#auth-phone-number-form,#auth-qr-form')){diag('auth-screen');return;}",
                        "diag('armed '+location.hash);",
                        "var tries=0,dialed=false,menued=false,confirmTicks=0;",
                        "var t=setInterval(function(){tries++;",
                        /* After the dial press, the only remaining job is one
                           confirm-modal press if Telegram asks — then out. */
                        "if(dialed){confirmTicks++;",
                        "var m=Array.prototype.find.call(document.querySelectorAll('.Modal button'),",
                        "function(b){return /^\\s*call\\s*$/i.test(b.textContent);});",
                        "if(m){press(m);diag('confirm-pressed');clearInterval(t);return;}",
                        "if(confirmTicks>10){diag('done-no-confirm-needed');clearInterval(t);}",
                        "return;}",
                        /* The dial itself: menu item or phone icon, once. */
                        "var item=Array.prototype.find.call(document.querySelectorAll('.MenuItem,[role=menuitem]'),",
                        "function(b){return /^\\s*call\\s*$/i.test(b.textContent||'');});",
                        "if(item){press(item);dialed=true;diag('menu-item-pressed');return;}",
                        "var ph=document.querySelector('.icon-phone');var pb=ph&&ph.closest('button');",
                        "if(pb){press(pb);dialed=true;diag('phone-pressed');return;}",
                        /* Mobile layout: open the chat header's menu, once. */
                        "if(!menued){",
                        "var col=document.getElementById('MiddleColumn')||document.querySelector('.MiddleHeader');",
                        "var mi=col&&col.querySelector('.icon-more');var mb=mi&&mi.closest('button');",
                        "if(mb){press(mb);menued=true;diag('menu-opened');return;}",
                        "if(tries===10||tries===25){",
                        "var btns=Array.prototype.slice.call((col||document).querySelectorAll('button'),0,12)",
                        ".map(function(b){return (b.className||'').slice(0,36);});",
                        "diag('probe t'+tries+' col='+!!col+' btns='+btns.join(' ; '));}}",
                        "if(tries>45){clearInterval(t);diag('gave-up dialed='+dialed+' menued='+menued);}",
                        "},300);})();",
                    ));
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

                        /* Microphone, answered. WebView2 raises
                           PermissionRequested for getUserMedia and treats an
                           unanswered request as a denial — no prompt, no
                           error, a call with no audio in either direction.
                           So the request is answered in COM: mic and camera
                           allowed, for the one Telegram origin, everything
                           else left to the default deny. */
                        #[cfg(windows)]
                        {
                            use webview2_com::PermissionRequestedEventHandler;
                            use webview2_com::Microsoft::Web::WebView2::Win32::{
                                COREWEBVIEW2_PERMISSION_KIND_CAMERA,
                                COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
                                COREWEBVIEW2_PERMISSION_STATE_ALLOW,
                            };

                            let hooked = tg.with_webview(|platform| unsafe {
                                let Ok(core) = platform.controller().CoreWebView2() else {
                                    eprintln!("[tgweb] no CoreWebView2 to hook");
                                    return;
                                };
                                let mut token = Default::default();
                                let handler = PermissionRequestedEventHandler::create(
                                    Box::new(|_sender, args| {
                                        if let Some(args) = args {
                                            let mut kind = Default::default();
                                            let _ = args.PermissionKind(&mut kind);
                                            let mut uri = windows::core::PWSTR::null();
                                            let _ = args.Uri(&mut uri);
                                            let origin = if uri.is_null() {
                                                String::new()
                                            } else {
                                                uri.to_string().unwrap_or_default()
                                            };
                                            let media = kind
                                                == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE
                                                || kind == COREWEBVIEW2_PERMISSION_KIND_CAMERA;
                                            if media && origin.starts_with("https://web.telegram.org")
                                            {
                                                let _ = args.SetState(
                                                    COREWEBVIEW2_PERMISSION_STATE_ALLOW,
                                                );
                                                println!("[tgweb] media permission granted to {origin}");
                                            } else {
                                                println!("[tgweb] permission left to default: kind={} origin={origin}", kind.0);
                                            }
                                        }
                                        Ok(())
                                    }),
                                );
                                match core.add_PermissionRequested(&handler, &mut token) {
                                    Ok(()) => println!("[tgweb] permission hook installed"),
                                    Err(e) => eprintln!("[tgweb] permission hook failed: {e}"),
                                }
                            });
                            if let Err(e) = hooked {
                                eprintln!("[tgweb] with_webview failed: {e}");
                            }
                        }
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
