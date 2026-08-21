/**
 * Scramble-on-hover for the headings.
 *
 * A heading resolves out of its own letters when you point at it. The letters
 * that land are the letters that were always there — every frame is an anagram
 * of what has not resolved yet, never a random alphabet — so the word reads as
 * settling into place rather than being typed by a machine.
 *
 * ── what it is applied to ────────────────────────────────────────────
 * Headings and the uppercase mini-headings above them, and nothing else. Body
 * copy, client names, numbers and quoted messages stay still. Two reasons, and
 * the second is the one that matters here:
 *
 *   1. A screen that animates everything teaches the eye to ignore animation.
 *   2. This app's whole claim is that every figure on screen traces to a real
 *      message. Text that rearranges itself is the one effect that could make a
 *      *value* look uncertain. Section headings carry no data, so scrambling
 *      them costs nothing; scrambling a latency or a name would undercut the
 *      product.
 *
 * ── how it attaches ──────────────────────────────────────────────────
 * render() in main.ts replaces whole subtrees of innerHTML, so anything bound
 * to a heading element directly dies on the next state change. This delegates
 * from a root that outlives every render — the same approach main.ts already
 * takes for clicks — and matches by selector, so newly rendered headings work
 * with no re-initialising and no markup to keep in sync.
 */

/** Milliseconds between frames. Slow enough to read as letters, not noise. */
const SPEED = 50;

/** How many frames to go from fully scrambled to fully resolved. */
const MAX_ITERATIONS = 8;

/** Longer than this and the scramble reads as damage rather than motion. */
const MAX_LENGTH = 64;

/**
 * The headings, in the order they appear on screen: page titles, tile titles,
 * the uppercase stat and pill labels, the "most urgent" flag, and the brand
 * wordmark.
 *
 * `.flag` is qualified because message rows reuse the class for evidence
 * markers inside a thread, which are data and must not move.
 *
 * The brand entry targets `.brand .wm`, never `.brand`. The pill also holds the
 * logo's inline <svg>, and a frame here is written with textContent — which
 * replaces every child. Pointed at the wrapper it would delete the mark on
 * first hover and never put it back, because the captured original is the
 * element's text and the svg is not text.
 */
const HEADINGS = ".hero-h, .tile-h .t, .lbl, .urgent .flag, .brand .wm";

/**
 * Fisher-Yates. Shuffles a copy — the caller's array is the source of truth for
 * what is still unresolved and must not be reordered under it.
 */
function shuffled(chars: string[]): string[] {
  const out = chars.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * One frame of the resolve.
 *
 * Everything left of `revealed` is final. Everything right of it is filled from
 * a shuffle of the characters not yet placed, which is what keeps each frame an
 * anagram of the tail rather than arbitrary glyphs.
 *
 * Spaces are structural — they hold the word boundaries still while the letters
 * move, so the heading keeps its shape and its width throughout and the layout
 * around it never reflows.
 */
function frame(chars: string[], revealed: number): string {
  const pool = shuffled(chars.slice(revealed).filter((c) => c !== " "));

  let next = 0;
  return chars
    .map((c, i) => {
      if (i < revealed) return c;
      if (c === " ") return " ";
      return pool[next++] ?? c;
    })
    .join("");
}

/** Interval id per element, for the frames still to come. */
const running = new WeakMap<HTMLElement, number>();

/**
 * Elements that have already played for the hover currently on them.
 *
 * This is what makes it fire once. pointerover fires again every time the
 * cursor crosses a boundary *inside* the element, so without this the heading
 * re-scrambles continuously for as long as the pointer keeps moving over it.
 * Cleared only when the pointer genuinely leaves, so the next hover replays.
 */
const played = new WeakSet<HTMLElement>();

function stop(el: HTMLElement): void {
  const timer = running.get(el);
  if (timer !== undefined) {
    window.clearInterval(timer);
    running.delete(el);
  }
}

/** Put the real heading back. Also the cleanup path for every early exit. */
function settle(el: HTMLElement): void {
  stop(el);
  const original = el.dataset.scrambleText;
  if (original !== undefined) el.textContent = original;
}

function start(el: HTMLElement): void {
  // Already animating, or already played for this hover.
  if (running.has(el) || played.has(el)) return;

  // Captured once and kept: mid-animation textContent is scrambled, so reading
  // it on a later hover would make the scramble permanent.
  const original = el.dataset.scrambleText ?? el.textContent ?? "";
  if (!original.trim() || original.length > MAX_LENGTH) return;
  el.dataset.scrambleText = original;
  played.add(el);

  const chars = [...original];
  let iteration = 0;

  const timer = window.setInterval(() => {
    // render() may have swapped this element out from under us. Writing to a
    // detached node is harmless, but the interval would outlive the DOM.
    if (!el.isConnected) {
      stop(el);
      return;
    }

    iteration++;
    if (iteration >= MAX_ITERATIONS) {
      settle(el);
      return;
    }

    el.textContent = frame(chars, Math.floor((iteration / MAX_ITERATIONS) * chars.length));
  }, SPEED);

  running.set(el, timer);
}

/**
 * Bind the effect to every heading under `root`, now and after every re-render.
 *
 * pointerenter/leave would be the natural events but they do not bubble, which
 * is the whole point of delegating. pointerover/out do bubble, at the cost of
 * firing again on every internal boundary — hence `played` above and the
 * containment check below.
 */
export function initScramble(root: HTMLElement): void {
  // Honouring this is not a nicety: rapidly permuting text is exactly the
  // pattern reduced-motion exists to suppress.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const headingAt = (ev: PointerEvent): HTMLElement | null =>
    (ev.target as HTMLElement | null)?.closest<HTMLElement>(HEADINGS) ?? null;

  root.addEventListener("pointerover", (ev) => {
    const el = headingAt(ev);
    if (el) start(el);
  });

  root.addEventListener("pointerout", (ev) => {
    const el = headingAt(ev);
    if (!el) return;

    // pointerout also fires moving between children of the heading. Only a
    // pointer that has genuinely left re-arms it.
    const to = ev.relatedTarget as Node | null;
    if (to && el.contains(to)) return;

    settle(el);
    played.delete(el);
  });
}
