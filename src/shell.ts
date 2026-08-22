/**
 * The Tauri side of the island.
 *
 * The window covers the work area and ignores the cursor, so the desktop stays
 * usable. That means the shell has to be told which rectangle is live: the page
 * reports the island's current bounds and Rust flips click-through when the
 * cursor crosses the boundary (see src-tauri/src/lib.rs).
 *
 * Two rules:
 *   · idle and peek report the island's own rect, padded a little so the edge
 *     of the pill is easy to hit;
 *   · open reports the whole viewport, because a dashboard you can't click away
 *     from is worse than one that briefly owns the screen.
 *
 * Uses `withGlobalTauri`, so there is no npm dependency on @tauri-apps/api —
 * the page stays a plain ES module that also runs in a browser.
 */

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

interface TauriGlobal {
  core?: { invoke?: Invoke };
  invoke?: Invoke;
}

const tauri = (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;

/**
 * Resolved defensively rather than assumed. If the global isn't shaped the way
 * we expect, every call becomes a no-op and the island still works as a plain
 * web page — a broken bridge must not take the UI down with it.
 */
const rawInvoke: Invoke | undefined =
  typeof tauri?.core?.invoke === "function"
    ? tauri.core.invoke.bind(tauri.core)
    : typeof tauri?.invoke === "function"
      ? tauri.invoke.bind(tauri)
      : undefined;

export const isTauri = rawInvoke !== undefined;

if (tauri !== undefined && rawInvoke === undefined) {
  console.error("[chadbuddy] running in Tauri but window.__TAURI__ exposes no invoke — click-through is disabled");
}

function invoke(cmd: string, args?: Record<string, unknown>): void {
  if (!rawInvoke) return;
  try {
    rawInvoke(cmd, args).catch((err: unknown) => {
      console.error(`[chadbuddy] invoke ${cmd} failed`, err);
    });
  } catch (err) {
    console.error(`[chadbuddy] invoke ${cmd} threw`, err);
  }
}

/**
 * Slack around the pill so the pointer doesn't have to be pixel-accurate.
 *
 * Kept small on purpose. Every pixel here is a pixel of someone's screen this
 * window captures without drawing anything on it, and at 10 the invisible
 * margin was 20px wider and taller than the pill it belonged to — enough to
 * swallow a browser tab the island was merely sitting near.
 */
const PAD = 6;

/**
 * The skirt once the island has grown.
 *
 * Hysteresis, and the reason it is needed: Rust samples the cursor every 60ms
 * and flips the window between capturing and ignoring at the boundary. A
 * pointer resting within a pixel or two of the edge crosses that boundary on
 * its own — hand tremor is larger than the sample grid — and each crossing
 * hands the page a real pointerleave followed by a real pointerenter. The
 * island then collapses and expands, repeatedly, while the cursor has not
 * meaningfully moved.
 *
 * A wider margin once expanded means leaving has to be deliberate. Entering
 * still uses the tight PAD, so the pill does not grab a cursor merely passing
 * near it.
 */
const PAD_EXPANDED = 18;

export function reportHotRect(island: HTMLElement): void {
  if (!isTauri) return;

  /* The open dashboard claims the entire viewport, and that claim is the most
     dangerous line in this file: the window is transparent and always on top,
     so a full-screen rectangle with nothing drawn inside it is an invisible
     sheet that swallows every click on the machine — including the ones that
     would close it.

     So the claim is conditional on the dashboard actually having rendered.
     If render() threw on the way to open, the layer is empty, and we fall
     through to reporting the island's own box instead. Worst case the pill is
     the wrong size for a moment; the alternative is a locked desktop. */
  /* Always measured, never assumed.

     This used to hard-code the whole viewport for the open state, on the
     reasoning that the dashboard covers the screen so the claim is accurate.
     It is accurate right up until the element is not where it is assumed to
     be — and then the window claims screen it does not occupy, which on a
     transparent always-on-top window means clicks vanish into nothing over an
     area the user can see straight through.

     Measuring instead makes the report self-correcting: whatever the island
     really occupies is what the shell captures, and a layout bug degrades to a
     wrongly-sized pill rather than to a locked desktop. The open dashboard
     still gets the whole viewport, because that is genuinely its size. */
  const st = island.dataset.state ?? "idle";
  const open = st === "open";

  /* The dashboard is 1360x860, not the viewport — so measuring it would leave
     the desktop around it clickable, and clicking away is how it closes. It
     claims the whole screen instead, which is safe now for three reasons that
     did not hold when this last went wrong: the stylesheet drops the drag
     offset in this state so the panel cannot be anywhere but centred, the page
     renews the claim every two seconds, and Rust stops honouring a claim that
     has gone six seconds without renewal.

     Still conditional on the dashboard having actually drawn. An empty open
     layer means render() failed, and a full-screen claim over nothing is the
     invisible sheet that swallows every click on the machine. */
  if (open) {
    const drawn = document.getElementById("l-open")?.childElementCount ?? 0;
    if (drawn > 0) {
      invoke("set_hot_rect", { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });
      return;
    }
    console.error("[chadbuddy] open with an empty dashboard — measuring instead of claiming the screen");
  }
  const expanded = st === "peek" || st === "alert" || st === "call";
  const pad = open ? 0 : expanded ? PAD_EXPANDED : PAD;
  const r = island.getBoundingClientRect();

  // Clipped to the viewport: off-screen area is not ours to capture.
  const x = Math.max(0, r.x - pad);
  const y = Math.max(0, r.y - pad);
  const w = Math.min(window.innerWidth - x, r.width + pad * 2 - (x - (r.x - pad)));
  const h = Math.min(window.innerHeight - y, r.height + pad * 2 - (y - (r.y - pad)));
  if (w <= 0 || h <= 0) return;

  invoke("set_hot_rect", { x, y, w, h });
}

/**
 * Report now and again when the morph finishes. Growing is safe either way —
 * the island expands around the cursor — but shrinking has to be reported
 * immediately so click-through resumes the moment the island is out of the way.
 */
export function watchHotRect(island: HTMLElement): void {
  if (!isTauri) return;

  reportHotRect(island);

  /* A heartbeat, and the reason for it: the last rectangle this page sends is
     the rectangle the shell keeps enforcing forever. If the page stops sending
     — a crash, a reload, a bug that skips render — whatever was last claimed
     stays claimed, and if that was the full screen the machine is unusable
     with no way back from inside the app. Re-sending on a timer means any
     desync is corrected within two seconds, and the Rust side can treat
     silence as a fault and let the cursor through. */
  window.setInterval(() => reportHotRect(island), 2000);

  /* Report every rendered size, not only the final one.

     transitionend alone leaves the shell holding the pre-morph rectangle for
     the whole 440ms the island is growing. For most of that the pill is
     visibly larger than the region the shell is willing to capture, so a
     cursor sitting in the newly grown part reads as outside — the window stops
     capturing, the page receives pointerleave, the island collapses, which
     puts the pill back under the cursor and starts the whole thing again. That
     is the expand-contract flutter.

     A ResizeObserver fires on each rendered frame of the transition, so the
     reported rectangle tracks the animation instead of trailing it. */
  /* Batched to one report per frame. An unbatched observer that measures its
     own target inside the callback trips 'ResizeObserver loop completed with
     undelivered notifications', which the browser raises as a window error —
     and anything listening for errors then fires on every frame of the morph. */
  let queued = false;
  new ResizeObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      reportHotRect(island);
    });
  }).observe(island);

  island.addEventListener("transitionend", (e) => {
    if (e.target !== island) return;
    if (e.propertyName === "width" || e.propertyName === "height") reportHotRect(island);
  });
  window.addEventListener("resize", () => reportHotRect(island));
}

/**
 * Open a deep link in whatever the OS has registered for it — tg:// for the
 * Telegram app, mailto: for the mail client. The Rust side allowlists the
 * schemes; anything else is refused there, not here, because the page is the
 * less trusted party in that conversation.
 */
/**
 * Telegram Web in a ChadBuddy-owned window, opened on one client's chat.
 * Returns the invoke promise so the caller can fall back to the OS deep link
 * when window creation fails.
 */
export function openTelegram(peer: string, dial = true): Promise<unknown> {
  return rawInvoke?.("open_telegram", { peer, dial }) ?? Promise.reject(new Error("not in tauri"));
}

export function openExternal(url: string): void {
  void rawInvoke?.("open_external", { url });
}

export function quit(): void {
  invoke("quit");
}

/**
 * Take keyboard focus.
 *
 * The window is created with `focus: false` so the pill never steals the caret
 * from whatever is being typed behind it. That is right until it becomes a
 * dashboard: Escape can only close a window that is receiving keystrokes, and
 * an unfocused one sends them to the editor behind instead. Called on open and
 * nowhere else.
 */
export function focusWindow(): void {
  invoke("focus_window");
}

/**
 * Ask the shell to hide the window from screen capture.
 *
 * Unlike the other calls this one waits for its answer. The OS can decline —
 * the capture-exclusion flag needs Windows 10 2004 or newer and is silently
 * ignored below that — so the page reflects what Rust reports rather than what
 * it asked for. A control that claims to be hiding you when it isn't is worse
 * than no control at all.
 *
 * Outside Tauri there is no window to protect, so this resolves false.
 */
export async function setContentProtected(on: boolean): Promise<boolean> {
  if (!rawInvoke) return false;
  try {
    return (await rawInvoke("set_content_protected", { protected: on })) === true;
  } catch (err) {
    console.error("[chadbuddy] set_content_protected failed", err);
    return false;
  }
}
