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

/** Slack around the pill so the pointer doesn't have to be pixel-accurate. */
const PAD = 10;

export function reportHotRect(island: HTMLElement): void {
  if (!isTauri) return;

  if (island.dataset.state === "open") {
    invoke("set_hot_rect", { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });
    return;
  }

  const r = island.getBoundingClientRect();
  invoke("set_hot_rect", {
    x: r.x - PAD,
    y: r.y - PAD,
    w: r.width + PAD * 2,
    h: r.height + PAD * 2,
  });
}

/**
 * Report now and again when the morph finishes. Growing is safe either way —
 * the island expands around the cursor — but shrinking has to be reported
 * immediately so click-through resumes the moment the island is out of the way.
 */
export function watchHotRect(island: HTMLElement): void {
  if (!isTauri) return;

  reportHotRect(island);
  island.addEventListener("transitionend", (e) => {
    if (e.target !== island) return;
    if (e.propertyName === "width" || e.propertyName === "height") reportHotRect(island);
  });
  window.addEventListener("resize", () => reportHotRect(island));
}

export function quit(): void {
  invoke("quit");
}
