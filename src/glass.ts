/**
 * The ask-the-agent panel, surfaced as liquid glass on the GPU.
 *
 * ── why here and nowhere else ────────────────────────────────────────
 * This is the only place in the app where the effect is not a trick. The
 * island version that came before it had to invent a gradient plate to have
 * anything to refract, because a transparent always-on-top window is never
 * handed the desktop behind it. That plate was fabricated, it read as a second
 * edge around the pill, and it is gone.
 *
 * The ask panel sits inside the open dashboard, on the app's own dark plane, so
 * the material has a real surface to sit on and the tint composites against a
 * colour that is genuinely there.
 *
 * ── how the black is avoided ─────────────────────────────────────────
 * The library configures its canvas with `alphaMode: "opaque"` and exposes no
 * way to change it, so every pixel it does not draw composites as black rather
 * than as nothing. Over a transparent overlay that blacked out the desktop.
 *
 * The fix is to stop fighting it: the canvas is mounted *inside* `.ask`, which
 * already carries `overflow: hidden` and a border radius. The panel clips the
 * canvas to its own rounded shape, so the square corners never show, and what
 * remains behind the glass is the dashboard's own dark surface — which the
 * Rosé Pine base sits close enough to that opaque reads as intentional depth
 * rather than as a hole.
 *
 * ── what is not in the scene ─────────────────────────────────────────
 * The panel's own text — the transcript, the chips, the composer — stays plain
 * DOM above the canvas. Type composited over the material stays crisp; type
 * sampled through it would not, and this panel's whole job is to answer with
 * quotes that can be read.
 */

import { Container, Glass, Renderer, Scene } from "@liquid-dom/core";

/** The panel that wears the glass. */
const PANEL = ".ask";

/**
 * The optical settings.
 *
 * Restraint is the brief: legible at the edges, almost absent across the face.
 * `thickness` well under the demo's 90 keeps refraction to a rim rather than a
 * bulge, and `cornerSmoothing` is what reads as a squircle instead of a rounded
 * rectangle — the biggest single difference between designed and default.
 */
const OPTICS = {
  blur: 10,
  spacing: 26,
  thickness: 44,
  /* --card #2a273f, the surface the rest of the app is built on. */
  tint: { r: 0.165, g: 0.153, b: 0.247, a: 0.55 },
  /* The panel already carries --edge in CSS; a second shadow would double it. */
  shadowColor: { r: 0, g: 0, b: 0, a: 0 },
} as const;

const CORNER_SMOOTHING = 0.75;

export interface PanelGlass {
  /** Re-attach to the current panel and draw a frame. Safe to call every frame. */
  sync(): void;
  /** Release GPU resources and remove the canvas. */
  destroy(): void;
}

/** Radius CSS has settled on for this panel, in CSS pixels. */
function radiusOf(el: HTMLElement): number {
  const px = Number.parseFloat(getComputedStyle(el).borderTopLeftRadius);
  return Number.isFinite(px) ? px : 16;
}

/**
 * Mount the glass inside the ask panel.
 *
 * Returns null when the platform has no WebGPU, and the app keeps its CSS
 * surface untouched — this is an enhancement to a design that already stands on
 * its own, so a machine without an adapter must lose the effect and nothing
 * else.
 */
export function initPanelGlass(root: HTMLElement): PanelGlass | null {
  if (!("gpu" in navigator)) {
    console.warn("[chadbuddy] no WebGPU — keeping the CSS panel surface");
    return null;
  }

  const scene = new Scene();
  const container = new Container(OPTICS);
  // pointerEvents stays off: the DOM above the canvas owns every hit, and the
  // composer has to keep real focus and caret behaviour.
  const glass = new Glass({ cornerSmoothing: CORNER_SMOOTHING, pointerEvents: false });
  container.add(glass);
  scene.add(container);

  const renderer = new Renderer({ scene });
  const canvas = renderer.canvas;
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  // Behind the panel's content, which CSS lifts to z-index 1.
  canvas.style.zIndex = "0";
  canvas.style.pointerEvents = "none";

  let panel: HTMLElement | null = null;

  const sync = (): void => {
    // render() rebuilds the dashboard's innerHTML wholesale, so the panel this
    // was attached to is routinely thrown away. Re-find it rather than holding
    // a reference that goes stale on the next state change.
    const next = root.querySelector<HTMLElement>(PANEL);

    if (!next) {
      if (panel) {
        canvas.remove();
        delete panel.dataset.glass;
        panel = null;
      }
      return;
    }

    if (next !== panel) {
      panel = next;
      // .ask is `position: relative` by way of its own layout; make certain,
      // because an absolutely positioned canvas needs a positioned ancestor or
      // it escapes to the viewport and blacks out the screen again.
      if (getComputedStyle(panel).position === "static") panel.style.position = "relative";
      panel.prepend(canvas);
      panel.dataset.glass = "on";
    }

    const r = panel.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;

    glass.x = 0;
    glass.y = 0;
    glass.width = r.width;
    glass.height = r.height;
    glass.cornerRadius = radiusOf(panel);

    renderer.render();
  };

  return {
    sync,
    destroy() {
      renderer.destroy();
      canvas.remove();
      if (panel) delete panel.dataset.glass;
    },
  };
}
