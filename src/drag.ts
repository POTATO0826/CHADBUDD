/**
 * Moving the island out of the way.
 *
 * The island parks at top-centre, which on most screens is exactly where the
 * browser's tab strip and the editor's title bar live. Click-through already
 * works — the shell only captures the cursor inside the reported rectangle —
 * but that is no help when the rectangle is sitting on the thing you are trying
 * to click. The honest fix is not smarter hit-testing, it is letting the pill
 * live somewhere else.
 *
 * ── drag versus click ────────────────────────────────────────────────
 * The idle island is one big button that opens the dashboard, so a drag and a
 * click start identically. They are told apart by distance: under the threshold
 * the pointer never moved and the click stands, over it the gesture becomes a
 * drag and the click that follows is swallowed once, in the capture phase,
 * before it can reach the delegated handler in main.ts.
 *
 * ── why a transform ──────────────────────────────────────────────────
 * #stage is a full-width flex row that centres the island. Setting left/top
 * would mean tearing that out and re-implementing the centring by hand. A
 * translate on the stage moves the pill without touching the layout that
 * positions it, and getBoundingClientRect still reports the moved rectangle —
 * so the hot rect the shell polls stays correct with no extra bookkeeping.
 *
 * Position survives restarts. An overlay that forgets where you put it is an
 * overlay you move every single day.
 */

const KEY = "chadbuddy.island.offset";

/** Pointer travel that turns a click into a drag, in CSS pixels. */
const THRESHOLD = 6;

/** How much of the island must stay on screen, so it can never be lost. */
const KEEP = 48;

interface Offset {
  x: number;
  y: number;
}

function load(): Offset {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { x: 0, y: 0 };
    const v = JSON.parse(raw) as Partial<Offset>;
    const x = Number(v.x);
    const y = Number(v.y);
    return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
  } catch {
    // A corrupt entry must not stop the island rendering.
    return { x: 0, y: 0 };
  }
}

function save(o: Offset): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    /* private mode, quota — the island still works, it just forgets. */
  }
}

/**
 * Keep the pill reachable.
 *
 * Clamped against the island's own box rather than the viewport alone, so the
 * limit holds whether it is the 232px idle pill or the wider alert state that
 * was dragged to the edge.
 */
function clamp(o: Offset, island: HTMLElement): Offset {
  const r = island.getBoundingClientRect();
  const maxX = Math.max(0, window.innerWidth / 2 + r.width / 2 - KEEP);
  const maxY = Math.max(0, window.innerHeight - r.height - 4);
  return {
    x: Math.min(maxX, Math.max(-maxX, o.x)),
    y: Math.min(maxY, Math.max(-4, o.y)),
  };
}

/**
 * Make the island draggable.
 *
 * `onMoved` is called whenever the pill lands somewhere new, so the caller can
 * re-report the click-through rectangle to the shell — the whole point of
 * moving it is that the shell stops capturing the old position.
 */
export function initDrag(
  stage: HTMLElement,
  island: HTMLElement,
  onMoved: () => void,
): void {
  let offset = load();

  const apply = (): void => {
    stage.style.transform = offset.x === 0 && offset.y === 0 ? "" : `translate(${offset.x}px, ${offset.y}px)`;
  };

  /* Restore, then tell the shell — in that order, and never one without the
     other.

     This is the whole hazard of moving the pill with a transform. The caller
     has already reported a rectangle for the centred position by the time this
     runs, so applying a saved offset silently desynchronises the two: the pill
     is drawn in the corner while the shell is still watching the middle of the
     screen, and since it ignores the cursor everywhere it is not watching, the
     pill becomes completely dead to the mouse. Clamped first, so an offset
     saved on a larger monitor cannot restore to somewhere unreachable. */
  offset = clamp(offset, island);
  apply();
  onMoved();
  // Again after layout settles — at boot the island may still be mid-morph,
  // and a rectangle measured from a half-sized pill is the same bug smaller.
  requestAnimationFrame(() => {
    offset = clamp(offset, island);
    apply();
    onMoved();
  });

  let from: { x: number; y: number } | null = null;
  let base: Offset = offset;
  let dragging = false;

  island.addEventListener("pointerdown", (ev) => {
    // The dashboard fills the screen and has its own scrolling and text
    // selection; dragging it would be meaningless and would fight both.
    if (island.dataset.state === "open") return;
    if (ev.button !== 0) return;

    from = { x: ev.clientX, y: ev.clientY };
    base = offset;
    dragging = false;
  });

  window.addEventListener("pointermove", (ev) => {
    if (!from) return;

    const dx = ev.clientX - from.x;
    const dy = ev.clientY - from.y;

    if (!dragging && Math.hypot(dx, dy) < THRESHOLD) return;

    if (!dragging) {
      dragging = true;
      island.setPointerCapture?.(ev.pointerId);
      island.dataset.dragging = "on";
    }

    offset = clamp({ x: base.x + dx, y: base.y + dy }, island);
    apply();
    // Report continuously, not on drop: the shell polls the cursor every 60ms,
    // and a stale rectangle mid-drag makes the island fall out from under the
    // pointer that is holding it.
    onMoved();
  });

  /* Ending a drag has to be idempotent and reachable from more than pointerup.

     The window is click-through outside the pill, so a pointer released over
     another application can leave pointerup undelivered. If that happened the
     drag never ended, data-dragging stayed on, and the rule that disables
     pointer events on the island's children while dragging never lifted — a
     pill that looks completely normal and ignores every click. */
  const endDrag = (): void => {
    if (!from) return;
    from = null;
    if (!dragging) return;
    dragging = false;
    delete island.dataset.dragging;
    save(offset);
    onMoved();
  };

  // Belt and braces for the case above: whatever else happened, the drag is
  // over the moment this window stops being the one receiving input.
  window.addEventListener("blur", endDrag);
  window.addEventListener("pointercancel", endDrag);

  window.addEventListener("pointerup", () => {
    const wasDragging = dragging;
    endDrag();
    if (!wasDragging) return;

    /* Swallow exactly the click this drag is about to produce, so letting go
       over the pill does not also open the dashboard.

       Disarmed on a timer as well as on use: a drag that ends off the pill
       never produces a click, and a listener left armed would eat an unrelated
       one much later — which looks exactly like the island randomly refusing
       to open. */
    const swallow = (ev: MouseEvent): void => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener("click", swallow, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 300);
  });

  // A pill parked near the right edge of a wide monitor would end up offscreen
  // when the window narrows; re-clamping on resize keeps it reachable.
  window.addEventListener("resize", () => {
    offset = clamp(offset, island);
    apply();
    save(offset);
    onMoved();
  });
}

/** Put the island back at top-centre. */
export function resetIslandPosition(stage: HTMLElement, onMoved: () => void): void {
  save({ x: 0, y: 0 });
  stage.style.transform = "";
  onMoved();
}
